// App.js — React Native root
// Navigation: ServerSetup → Login → Dashboard → Image/Video/History
import React, { useEffect, useState } from 'react'
import { View, ActivityIndicator, StyleSheet } from 'react-native'
import { NavigationContainer, DefaultTheme } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useAppStore } from './src/store/appStore'
import { setApiUrl, getTokens } from './src/api'

import ServerSetupScreen       from './src/screens/ServerSetupScreen'
import LoginScreen             from './src/screens/LoginScreen'
import DashboardScreen         from './src/screens/DashboardScreen'
import ImageGenerationScreen   from './src/screens/ImageGenerationScreen'
import VideoGenerationScreen   from './src/screens/VideoGenerationScreen'
import HistoryScreen           from './src/screens/HistoryScreen'

const Stack    = createNativeStackNavigator()
const NAV_THEME = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: '#0d0d12' },
}

function AppNavigator() {
  const { isLoggedIn, authChecked, isReady } = useAppStore()
  const checkAuth = useAppStore(s => s.checkAuth)
  const [serverConfigured, setServerConfigured] = useState(null) // null=loading

  useEffect(() => {
    async function bootstrap() {
      // Check if a server URL has been saved
      const savedUrl = await AsyncStorage.getItem('api_base_url').catch(() => null)
      if (savedUrl) {
        setApiUrl(savedUrl)
        setServerConfigured(true)
        await checkAuth()
      } else {
        setServerConfigured(false)
      }
    }
    bootstrap()
  }, [])

  // Show spinner while bootstrapping
  if (serverConfigured === null || (!isReady && serverConfigured)) {
    return (
      <View style={s.loading}>
        <ActivityIndicator size="large" color="#7c6af7" />
      </View>
    )
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!serverConfigured ? (
        // First time — need server URL
        <Stack.Screen name="ServerSetup">
          {props => <ServerSetupScreen {...props} onComplete={() => setServerConfigured(true)} />}
        </Stack.Screen>
      ) : !isLoggedIn ? (
        // Have server URL but not logged in
        <>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="ServerSetup">
            {props => <ServerSetupScreen {...props} onComplete={() => {}} />}
          </Stack.Screen>
        </>
      ) : (
        // Logged in — main app
        <>
          <Stack.Screen name="Dashboard"       component={DashboardScreen} />
          <Stack.Screen name="ImageGeneration" component={ImageGenerationScreen} />
          <Stack.Screen name="VideoGeneration" component={VideoGenerationScreen} />
          <Stack.Screen name="History"         component={HistoryScreen} />
          <Stack.Screen name="ServerSetup">
            {props => <ServerSetupScreen {...props} onComplete={() => {}} />}
          </Stack.Screen>
        </>
      )}
    </Stack.Navigator>
  )
}

export default function App() {
  return (
    <NavigationContainer theme={NAV_THEME}>
      <AppNavigator />
    </NavigationContainer>
  )
}

const s = StyleSheet.create({
  loading: { flex: 1, backgroundColor: '#0d0d12', alignItems: 'center', justifyContent: 'center' },
})
