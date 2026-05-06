// src/screens/HistoryScreen.js
import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  SafeAreaView, StatusBar, Image, ActivityIndicator, RefreshControl,
} from 'react-native'
import { getJobHistory, friendlyError } from '../api'
import { useAppStore } from '../store/appStore'

function formatAge(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ago`
  if (h > 0) return `${h}h ago`
  if (m > 0) return `${m}m ago`
  return 'just now'
}

function JobCard({ job, onReusePrompt }) {
  const isImage    = job.type === 'image'
  const isComplete = job.status === 'completed'

  return (
    <View style={s.card}>
      {/* Thumbnail */}
      <View style={s.thumb}>
        {isComplete && job.output_url ? (
          isImage
            ? <Image source={{ uri: job.output_url }} style={s.thumbImg} resizeMode="cover" />
            : <View style={s.videoThumb}><Text style={s.videoIcon}>▶</Text></View>
        ) : (
          <View style={s.thumbPlaceholder}>
            <Text style={[s.statusText,
              job.status === 'failed' ? s.statusFailed : s.statusPending]}>
              {job.status}
            </Text>
          </View>
        )}
        <View style={[s.typeBadge, isImage ? s.typeBadgeImage : s.typeBadgeVideo]}>
          <Text style={s.typeBadgeText}>{job.type}</Text>
        </View>
      </View>

      {/* Info */}
      <View style={s.cardInfo}>
        <Text style={s.promptText} numberOfLines={2}>{job.prompt}</Text>
        <View style={s.cardFooter}>
          <Text style={s.ageText}>{formatAge(job.created_at)}</Text>
          {isComplete && (
            <TouchableOpacity onPress={() => onReusePrompt(job)}>
              <Text style={s.reuseText}>Reuse prompt</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  )
}

export default function HistoryScreen({ navigation }) {
  const history      = useAppStore(s => s.history)
  const setHistory   = useAppStore(s => s.setHistory)
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError]         = useState('')

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    setError('')
    try {
      const data = await getJobHistory(30)
      setHistory(data.jobs || [])
    } catch (err) {
      setError(friendlyError(err.message))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [setHistory])

  useEffect(() => { load() }, [load])

  function handleReusePrompt(job) {
    const screen = job.type === 'video' ? 'VideoGeneration' : 'ImageGeneration'
    navigation.navigate(screen, { prompt: job.prompt })
  }

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0d0d12" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Text style={s.backText}>←</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Generation History</Text>
        <View style={s.platformBadge}>
          <Text style={s.platformText}>Android</Text>
        </View>
      </View>

      {loading && (
        <View style={s.center}>
          <ActivityIndicator size="large" color="#7c6af7" />
        </View>
      )}

      {!!error && (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}

      {!loading && !error && (
        <FlatList
          data={history}
          keyExtractor={j => j.job_id}
          renderItem={({ item }) => (
            <JobCard job={item} onReusePrompt={handleReusePrompt} />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor="#7c6af7"
            />
          }
          ListEmptyComponent={
            <View style={s.center}>
              <Text style={s.emptyText}>No generations yet</Text>
              <Text style={s.emptyHint}>Go to Image or Video to start creating</Text>
            </View>
          }
          contentContainerStyle={history.length === 0 ? s.emptyContainer : s.listContent}
        />
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0d0d12' },
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#2e2e3a' },
  backBtn:        { padding: 8, backgroundColor: '#1e1e28', borderRadius: 8 },
  backText:       { color: '#f0eee8', fontSize: 18, fontWeight: '600' },
  headerTitle:    { color: '#f0eee8', fontSize: 15, fontWeight: '600' },
  platformBadge:  { backgroundColor: '#1a2456', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  platformText:   { color: '#7c9af7', fontSize: 10, fontWeight: '600' },
  center:         { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  errorBox:       { margin: 16, backgroundColor: '#2e1010', borderRadius: 10, padding: 14 },
  errorText:      { color: '#e07070', fontSize: 13 },
  listContent:    { padding: 12 },
  emptyContainer: { flex: 1 },
  emptyText:      { color: '#3a3a48', fontSize: 16, fontWeight: '600', marginBottom: 8 },
  emptyHint:      { color: '#2a2a38', fontSize: 13 },
  card:           { flexDirection: 'row', backgroundColor: '#18181f', borderRadius: 12, marginBottom: 10, overflow: 'hidden', borderWidth: 1, borderColor: '#2e2e3a' },
  thumb:          { width: 90, height: 90, backgroundColor: '#1e1e28', position: 'relative' },
  thumbImg:       { width: '100%', height: '100%' },
  videoThumb:     { width: '100%', height: '100%', backgroundColor: '#1a1830', alignItems: 'center', justifyContent: 'center' },
  videoIcon:      { color: '#7c6af7', fontSize: 24 },
  thumbPlaceholder: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  statusText:     { fontSize: 11, fontWeight: '600' },
  statusFailed:   { color: '#e07070' },
  statusPending:  { color: '#a0a0b0' },
  typeBadge:      { position: 'absolute', top: 6, left: 6, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  typeBadgeImage: { backgroundColor: '#1a2456' },
  typeBadgeVideo: { backgroundColor: '#2a1456' },
  typeBadgeText:  { color: '#a99af7', fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
  cardInfo:       { flex: 1, padding: 12, justifyContent: 'space-between' },
  promptText:     { color: '#e8e6e0', fontSize: 13, lineHeight: 18 },
  cardFooter:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  ageText:        { color: '#4a4a58', fontSize: 11 },
  reuseText:      { color: '#7c6af7', fontSize: 11, fontWeight: '500' },
})
