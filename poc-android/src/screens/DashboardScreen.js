// src/screens/DashboardScreen.js
import React, { useEffect } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, StatusBar, Alert,
} from 'react-native'
import { logout, checkHealth } from '../api'
import { useAppStore } from '../store/appStore'

function NavCard({ onPress, emoji, title, subtitle, color }) {
  return (
    <TouchableOpacity
      style={[s.card, { borderColor: color + '40' }]}
      onPress={onPress}
      activeOpacity={0.7}>
      <View style={[s.cardIcon, { backgroundColor: color + '20' }]}>
        <Text style={s.cardEmoji}>{emoji}</Text>
      </View>
      <Text style={s.cardTitle}>{title}</Text>
      <Text style={s.cardSubtitle}>{subtitle}</Text>
    </TouchableOpacity>
  )
}

export default function DashboardScreen({ navigation }) {
  const user     = useAppStore(s => s.user)
  const clearUser = useAppStore(s => s.clearUser)

  useEffect(() => {
    checkHealth().then(h => {
      if (!h) {
        Alert.alert('Server offline', 'Cannot reach the backend server. Check that npm start is running and ngrok is active.')
      }
    })
  }, [])

  async function handleLogout() {
    await logout()
    clearUser()
    navigation.replace('Login')
  }

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0d0d12" />

      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={s.logo}>
            <Text style={s.logoText}>✦</Text>
          </View>
          <Text style={s.headerTitle}>AI Creative Studio</Text>
        </View>
        <View style={s.headerRight}>
          <TouchableOpacity
            style={s.headerBtn}
            onPress={() => navigation.navigate('History')}>
            <Text style={s.headerBtnText}>⏱</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.headerBtn} onPress={handleLogout}>
            <Text style={s.headerBtnText}>⎋</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Platform badge — shows user is on Android */}
      <View style={s.platformBadge}>
        <Text style={s.platformText}>📱 Android</Text>
      </View>

      {/* Welcome */}
      <Text style={s.welcomeTitle}>What will you create?</Text>
      <Text style={s.welcomeSub}>
        {user?.email || user?.name ? `Hello, ${user.email || user.name}` : 'Choose a generation type'}
      </Text>

      {/* Nav cards */}
      <View style={s.cardRow}>
        <NavCard
          onPress={() => navigation.navigate('ImageGeneration')}
          emoji="🎨"
          title="AI Image"
          subtitle="Generate images from text"
          color="#5fa8d3"
        />
        <NavCard
          onPress={() => navigation.navigate('VideoGeneration')}
          emoji="🎬"
          title="AI Video"
          subtitle="Create videos from text"
          color="#7c6af7"
        />
      </View>

      {/* History shortcut */}
      <TouchableOpacity
        style={s.historyLink}
        onPress={() => navigation.navigate('History')}>
        <Text style={s.historyLinkText}>View generation history →</Text>
      </TouchableOpacity>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#0d0d12' },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#2e2e3a' },
  headerLeft:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo:            { width: 30, height: 30, borderRadius: 8, backgroundColor: '#7c6af7', alignItems: 'center', justifyContent: 'center' },
  logoText:        { color: '#fff', fontSize: 14, fontWeight: '700' },
  headerTitle:     { color: '#f0eee8', fontSize: 16, fontWeight: '600' },
  headerRight:     { flexDirection: 'row', gap: 8 },
  headerBtn:       { padding: 8, borderRadius: 8, backgroundColor: '#1e1e28' },
  headerBtnText:   { fontSize: 16 },
  platformBadge:   { alignSelf: 'flex-start', marginHorizontal: 20, marginTop: 12, backgroundColor: '#1a2456', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  platformText:    { color: '#7c9af7', fontSize: 11, fontWeight: '600' },
  welcomeTitle:    { fontSize: 26, fontWeight: '700', color: '#f0eee8', marginHorizontal: 20, marginTop: 32, marginBottom: 6 },
  welcomeSub:      { fontSize: 14, color: '#6a6878', marginHorizontal: 20, marginBottom: 32 },
  cardRow:         { flexDirection: 'row', gap: 12, marginHorizontal: 20 },
  card:            { flex: 1, backgroundColor: '#18181f', borderRadius: 16, padding: 20, borderWidth: 1 },
  cardIcon:        { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  cardEmoji:       { fontSize: 22 },
  cardTitle:       { color: '#f0eee8', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  cardSubtitle:    { color: '#6a6878', fontSize: 12, lineHeight: 16 },
  historyLink:     { marginHorizontal: 20, marginTop: 24, alignItems: 'center', padding: 12 },
  historyLinkText: { color: '#4a4a68', fontSize: 13 },
})
