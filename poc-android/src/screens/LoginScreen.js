// src/screens/LoginScreen.js
import React, { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native'
import { login } from '../api'
import { useAppStore } from '../store/appStore'

export default function LoginScreen({ navigation }) {
  const setUser   = useAppStore(s => s.setUser)
  const serverUrl = useAppStore(s => s.serverUrl)
  const [key, setKey]         = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  async function handleLogin() {
    const k = key.trim()
    if (!k) return
    setLoading(true)
    setError('')
    try {
      const user = await login(k)
      setUser(user)
      navigation.replace('Dashboard')
    } catch (err) {
      setError(err.message || 'Invalid license key')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.card}>
        <View style={s.logo}>
          <Text style={s.logoText}>✦</Text>
        </View>
        <Text style={s.title}>AI Creative Studio</Text>
        <Text style={s.subtitle}>Enter your license key to continue</Text>

        <Text style={s.serverLabel}>
          Connected to: <Text style={s.serverUrl}>{serverUrl || 'localhost'}</Text>
        </Text>

        <Text style={s.label}>License key</Text>
        <TextInput
          style={s.input}
          value={key}
          onChangeText={setKey}
          placeholder="poc-test-key-12345678"
          placeholderTextColor="#4a4a5a"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={handleLogin}
        />

        {!!error && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[s.button, (loading || !key.trim()) && s.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading || !key.trim()}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.buttonText}>Sign in</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={s.changeServer}
          onPress={() => navigation.navigate('ServerSetup')}>
          <Text style={s.changeServerText}>Change server URL</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#0d0d12', justifyContent: 'center', padding: 24 },
  card:            { backgroundColor: '#18181f', borderRadius: 16, padding: 28, borderWidth: 1, borderColor: '#2e2e3a' },
  logo:            { width: 56, height: 56, borderRadius: 14, backgroundColor: '#7c6af7', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 16 },
  logoText:        { color: '#fff', fontSize: 24, fontWeight: '700' },
  title:           { fontSize: 22, fontWeight: '700', color: '#f0eee8', textAlign: 'center', marginBottom: 6 },
  subtitle:        { fontSize: 14, color: '#6a6878', textAlign: 'center', marginBottom: 8 },
  serverLabel:     { fontSize: 11, color: '#4a4a58', textAlign: 'center', marginBottom: 20 },
  serverUrl:       { color: '#7c6af7' },
  label:           { fontSize: 13, color: '#9a9890', marginBottom: 8 },
  input:           { backgroundColor: '#1e1e28', borderWidth: 1, borderColor: '#3a3a48', borderRadius: 10, padding: 14, color: '#f0eee8', fontSize: 14, marginBottom: 12 },
  errorBox:        { backgroundColor: '#2e1010', borderRadius: 8, padding: 12, marginBottom: 12 },
  errorText:       { color: '#e07070', fontSize: 13 },
  button:          { backgroundColor: '#7c6af7', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 12 },
  buttonDisabled:  { opacity: 0.4 },
  buttonText:      { color: '#fff', fontSize: 15, fontWeight: '600' },
  changeServer:    { alignItems: 'center', padding: 8 },
  changeServerText:{ color: '#4a4a68', fontSize: 12 },
})
