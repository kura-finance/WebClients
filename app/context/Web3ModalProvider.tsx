// Web3 Modal Provider
'use client'

import React, { ReactNode, useMemo } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider, type State } from 'wagmi'
import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { mainnet, arbitrum, polygon, type AppKitNetwork } from '@reown/appkit/networks'
import AppSessionHydrator from '@/components/AppSessionHydrator'
import { env } from '@/config/env'
import { features } from '@/config/features'

// 1. 設定 React Query
const queryClient = new QueryClient()

// Reown（原 WalletConnect）專案 ID
const projectId = env.reownProjectId
const fallbackAppUrl = env.appUrl

// 在執行期從瀏覽器取得實際 URL（僅客戶端）
const getWalletMetadataUrl = () => {
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.host}`;
  }
  return fallbackAppUrl;
}

const networks: [AppKitNetwork, ...AppKitNetwork[]] = [mainnet, arbitrum, polygon]

const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  ssr: true,
})

let appKitInitialized = false

function ensureAppKitInitialized() {
  if (appKitInitialized) return
  // AppKit (Reown) is only used to connect wallets for TrackFi tracking. Without
  // it the wagmi config stays connector-less, so hooks work but nothing connects.
  if (!features.trackFi) return
  if (!projectId) {
    console.warn('[Web3ModalProvider] NEXT_PUBLIC_REOWN_PROJECT_ID is missing, AppKit is disabled.')
    return
  }

  createAppKit({
    adapters: [wagmiAdapter],
    networks,
    projectId,
    metadata: {
      name: 'Kura',
      description: 'Kura wallet connection',
      url: getWalletMetadataUrl(),
      icons: ['https://reown.com/logo.png'],
    },
    features: {
      analytics: false,
    },
  })
  appKitInitialized = true
}

// 6. 建立 Provider 元件
export default function Web3ModalProvider({
  children,
  initialState
}: {
  children: ReactNode
  initialState?: State
}) {
  const config = useMemo(() => {
    ensureAppKitInitialized()
    return wagmiAdapter.wagmiConfig
  }, [])
  return (
    <WagmiProvider config={config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <AppSessionHydrator />
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  )
}