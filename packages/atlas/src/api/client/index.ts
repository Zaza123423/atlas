import { ApolloClient, ApolloLink, FetchResult, HttpLink, Observable, split } from '@apollo/client'
import { GraphQLWsLink } from '@apollo/client/link/subscriptions'
import { getMainDefinition } from '@apollo/client/utilities'
import { createClient } from 'graphql-ws'

import { atlasConfig } from '@/config'
import { ORION_GRAPHQL_URL, QUERY_NODE_GRAPHQL_SUBSCRIPTION_URL } from '@/config/env'
import { logDistributorPerformance, testAssetDownload } from '@/providers/assets/assets.helpers'
import { useUserLocationStore } from '@/providers/userLocation'
import { AssetLogger, ConsoleLogger, DistributorEventEntry, SentryLogger } from '@/utils/logs'
import { TimeoutError, withTimeout } from '@/utils/misc'

import cache from './cache'

import { StorageDataObject } from '../queries/__generated__/baseTypes.generated'

const delayLink = new ApolloLink((operation, forward) => {
  const ctx = operation.getContext()
  if (!ctx.delay) {
    return forward(operation)
  }

  return new Observable<FetchResult>((observer) => {
    setTimeout(() => {
      forward(operation).subscribe((value) => {
        observer.next(value)
      })
    }, ctx.delay)
  })
})

const MAX_ALLOWED_RETRIES = 10
const bannedDistributorUrls: Record<string, number> = {}

const createApolloClient = () => {
  const subscriptionLink = new GraphQLWsLink(
    createClient({
      url: QUERY_NODE_GRAPHQL_SUBSCRIPTION_URL,
      retryAttempts: 5,
    })
  )

  const orionLink = ApolloLink.from([delayLink, new HttpLink({ uri: ORION_GRAPHQL_URL })])

  const operationSplitLink = split(
    ({ query, setContext }) => {
      const locationStore = useUserLocationStore.getState()

      if (
        !locationStore.disableUserLocation &&
        locationStore.coordinates?.latitude &&
        locationStore.coordinates.longitude
      ) {
        setContext(({ headers }: Record<string, object>) => {
          return {
            headers: {
              ...headers,
              'x-client-loc': `${locationStore?.coordinates?.latitude}, ${locationStore.coordinates?.longitude}`,
            },
          }
        })
      }

      const definition = getMainDefinition(query)
      return definition.kind === 'OperationDefinition' && definition.operation === 'subscription'
    },
    subscriptionLink,
    orionLink
  )

  return new ApolloClient({
    cache,
    link: operationSplitLink,
    resolvers: {
      StorageDataObject: {
        resolvedUrl: async (parent: StorageDataObject) => {
          if (!parent.isAccepted) {
            return null
          }

          // skip distributor url if he failed more than n times(where n is MAX_ALLOWED_RETRIES)
          const resolvedUrls = parent.resolvedUrls?.filter((url) => {
            const distributorUrl = url.split(`/${atlasConfig.storage.assetPath}/${parent.id}`)[0]
            return (bannedDistributorUrls[distributorUrl] || 0) <= MAX_ALLOWED_RETRIES
          })

          for (const resolvedUrl of resolvedUrls) {
            if (!parent.type) {
              return null
            }

            if (parent.type.__typename === 'DataObjectTypeChannelPayoutsPayload') {
              // if this is a payload file skip testing and just return first url.
              return resolvedUrls[0]
            }
            const distributorUrl = resolvedUrl.split(`/${atlasConfig.storage.assetPath}/${parent.id}`)[0]

            const assetTestPromise = testAssetDownload(resolvedUrl, parent.type)
            const assetTestPromiseWithTimeout = withTimeout(assetTestPromise, atlasConfig.storage.assetResponseTimeout)
            const eventEntry: DistributorEventEntry = {
              distributorUrl,
              dataObjectId: parent.id,
              dataObjectType: parent.type?.__typename,
            }

            try {
              await assetTestPromiseWithTimeout

              logDistributorPerformance(resolvedUrl, eventEntry)
              return resolvedUrl
            } catch (err) {
              if (err instanceof MediaError) {
                SentryLogger.error('Error during asset download test, media is not supported', 'AssetsManager', err, {
                  asset: { parent, resolvedUrl, mediaError: err },
                })
                return null
              }
              bannedDistributorUrls[distributorUrl] = (bannedDistributorUrls[distributorUrl] || 0) + 1
              if (err instanceof TimeoutError) {
                AssetLogger.logDistributorResponseTimeout(eventEntry)
                ConsoleLogger.warn(
                  `Distributor didn't respond in ${atlasConfig.storage.assetResponseTimeout} seconds`,
                  {
                    dataObject: parent,
                  }
                )
              } else {
                AssetLogger.logDistributorError(eventEntry)
                SentryLogger.error('Error during asset download test', 'AssetsManager', err, {
                  asset: { parent, resolvedUrl },
                })
              }
            }
          }
          return null
        },
      },
    },
  })
}

export default createApolloClient
