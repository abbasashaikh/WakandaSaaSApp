// src/screens/ServerSetupScreen.js
// Shown only on first launch or when server URL is not set.
// No equivalent on Windows — Electron bakes the URL at build time.
// On Android, the URL is configurable at runtime.
import React, { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { setApiUrl, checkHealth } from '../api'
import { useAppStore } from '../store/appStore'

export default function ServerSetupScreen({ onComplete }) {
  const setServerUrl = useAppStore(s => s.setServerUrl)
  const [url, setUrl]           = useState('https://')
  const [testing, setTesting]   = useState(false)

  async function handleConnect() {
    const clean = url.trim().replace(/\/+$/, '')
    if (!clean.startsWith('http')) {
      Alert.alert('Invalid URL', 'URL must start with https://')
      return
    }
    setTesting(true)
    try {
      setApiUrl(clean)
      const health = await checkHealth()
      if (!health || health.status !== 'ok') {
        throw new Error('Server returned unexpected response')
      }
      await AsyncStorage.setItem('api_base_url', clean)
      setServerUrl(clean)
      onComplete()
    } catch (err) {
      Alert.alert(
        'Cannot connect',
        `Could not reach server at:\n${clean}\n\nCheck:\n• Is the server running?\n• Is the URL correct?\n• Is ngrok active?`,
      )
    } finally {
      setTesting(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.card}>
        {/* Logo */}
        <View style={s.logo}>
          <Text style={s.logoText}>✦</Text>
        </View>
        <Text style={s.title}>AI Creative Studio</Text>
        <Text style={s.subtitle}>Enter your server URL to connect</Text>

        <Text style={s.label}>Server URL</Text>
        <TextInput
          style={s.input}
          value={url}
          onChangeText={setUrl}
          placeholder="https://your-ngrok-url.ngrok-free.app"
          placeholderTextColor="#4a4a5a"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={handleConnect}
        />
        <Text style={s.hint}>
          Get this URL from your backend machine (ngrok tunnel URL)
        </Text>

        <TouchableOpacity
          style={[s.button, testing && s.buttonDisabled]}
          onPress={handleConnect}
          disabled={testing}>
          {testing
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.buttonText}>Connect</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#0d0d12', justifyContent: 'center', padding: 24 },
  card:          { backgroundColor: '#18181f', borderRadius: 16, padding: 28, borderWidth: 1, borderColor: '#2e2e3a' },
  logo:          { width: 56, height: 56, borderRadius: 14, backgroundColor: '#7c6af7', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 16 },
  logoText:      { color: '#fff', fontSize: 24, fontWeight: '700' },
  title:         { fontSize: 22, fontWeight: '700', color: '#f0eee8', textAlign: 'center', marginBottom: 6 },
  subtitle:      { fontSize: 14, color: '#6a6878', textAlign: 'center', marginBottom: 24 },
  label:         { fontSize: 13, color: '#9a9890', marginBottom: 8 },
  input:         { backgroundColor: '#1e1e28', borderWidth: 1, borderColor: '#3a3a48', borderRadius: 10, padding: 14, color: '#f0eee8', fontSize: 14, marginBottom: 8 },
  hint:          { fontSize: 11, color: '#4a4a58', marginBottom: 20, lineHeight: 16 },
  button:        { backgroundColor: '#7c6af7', borderRadius: 12, padding: 16, alignItems: 'center' },
  buttonDisabled:{ opacity: 0.5 },
  buttonText:    { color: '#fff', fontSize: 15, fontWeight: '600' },
})
