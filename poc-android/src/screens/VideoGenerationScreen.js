// src/screens/VideoGenerationScreen.js
import React, { useState, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, SafeAreaView, StatusBar, ActivityIndicator, Alert,
} from 'react-native'
import Video from 'react-native-video'
import { generateVideo, startPolling, friendlyError } from '../api'
import { useAppStore } from '../store/appStore'

const DURATIONS = ['4s', '8s']
const QUALITIES  = ['fast', 'quality']

export default function VideoGenerationScreen({ navigation }) {
  const addJob         = useAppStore(s => s.addJob)
  const updateJob      = useAppStore(s => s.updateJob)
  const prependHistory = useAppStore(s => s.prependHistory)

  const [prompt, setPrompt]     = useState('')
  const [duration, setDuration] = useState('8s')
  const [quality, setQuality]   = useState('fast')
  const [status, setStatus]     = useState('idle')
  const [outputUrl, setUrl]     = useState(null)
  const [errorMsg, setError]    = useState('')
  const [elapsed, setElapsed]   = useState(0)
  const stopRef = useRef(null)
  const timerRef = useRef(null)

  function startTimer() {
    setElapsed(0)
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
  }
  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }

  async function handleGenerate() {
    const trimmed = prompt.trim()
    if (!trimmed) {
      Alert.alert('Enter a prompt', 'Describe the video you want to generate.')
      return
    }
    setStatus('queued')
    setUrl(null)
    setError('')
    stopRef.current?.()
    stopTimer()
    startTimer()

    try {
      const cleanDuration = parseInt(duration)
      const res = await generateVideo(trimmed, { duration: cleanDuration, quality })
      const jobId = res.job_id
      addJob({ job_id: jobId, status: 'queued', prompt: trimmed, type: 'video' })

      stopRef.current = startPolling(jobId, {
        onProgress: (job) => {
          setStatus(job.status)
          updateJob(jobId, job)
        },
        onComplete: (job) => {
          stopTimer()
          setStatus('completed')
          setUrl(job.output_url)
          prependHistory({ ...job, prompt: trimmed })
          stopRef.current?.()
        },
        onError: (msg) => {
          stopTimer()
          setStatus('failed')
          setError(msg)
          stopRef.current?.()
        },
      })
    } catch (err) {
      stopTimer()
      setStatus('failed')
      setError(friendlyError(err.message))
    }
  }

  function handleReset() {
    stopRef.current?.()
    stopTimer()
    setStatus('idle')
    setUrl(null)
    setError('')
    setElapsed(0)
  }

  const mins = Math.floor(elapsed / 60)
  const secs = String(elapsed % 60).padStart(2, '0')

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0d0d12" />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Text style={s.backText}>←</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <View style={[s.dot, status === 'processing' && s.dotActive]} />
          <Text style={s.headerTitle}>AI Video Generation</Text>
        </View>
        <View style={s.platformBadge}>
          <Text style={s.platformText}>Android</Text>
        </View>
      </View>

      <ScrollView style={s.scroll} keyboardShouldPersistTaps="handled">
        {/* Preview area */}
        <View style={s.canvas}>
          {status === 'idle' && (
            <Text style={s.placeholder}>Your video will appear here</Text>
          )}
          {(status === 'queued' || status === 'processing') && (
            <View style={s.loadingBox}>
              <ActivityIndicator size="large" color="#7c6af7" />
              <Text style={s.loadingText}>
                {status === 'queued' ? 'Queued…' : 'Generating video…'}
              </Text>
              <Text style={s.timer}>{mins}:{secs}</Text>
              <Text style={s.loadingHint}>Videos take 1–3 minutes</Text>
            </View>
          )}
          {status === 'completed' && outputUrl && (
            <Video
              source={{ uri: outputUrl }}
              style={s.video}
              controls
              resizeMode="contain"
              repeat
            />
          )}
          {status === 'failed' && (
            <View style={s.failBox}>
              <Text style={s.failIcon}>⚠️</Text>
              <Text style={s.failTitle}>Video generation failed</Text>
              <Text style={s.failMsg}>{errorMsg}</Text>
              <TouchableOpacity style={s.retryBtn} onPress={handleReset}>
                <Text style={s.retryText}>Try again</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Duration selector */}
        <Text style={s.sectionLabel}>Duration</Text>
        <View style={s.optionRow}>
          {DURATIONS.map(d => (
            <TouchableOpacity
              key={d}
              style={[s.optionBtn, duration === d && s.optionBtnActive]}
              onPress={() => setDuration(d)}>
              <Text style={[s.optionText, duration === d && s.optionTextActive]}>{d}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Quality selector */}
        <Text style={s.sectionLabel}>Quality</Text>
        <View style={s.optionRow}>
          {QUALITIES.map(q => (
            <TouchableOpacity
              key={q}
              style={[s.optionBtn, quality === q && s.optionBtnActive]}
              onPress={() => setQuality(q)}>
              <Text style={[s.optionText, quality === q && s.optionTextActive]}>
                {q === 'fast' ? '⚡ Fast' : '✨ Quality'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Prompt */}
        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            value={prompt}
            onChangeText={setPrompt}
            placeholder="Describe the video you want…"
            placeholderTextColor="#4a4a5a"
            multiline
            maxLength={500}
            editable={status !== 'queued' && status !== 'processing'}
          />
          <TouchableOpacity
            style={[s.sendBtn, (!prompt.trim() || status === 'queued' || status === 'processing') && s.sendBtnDisabled]}
            onPress={handleGenerate}
            disabled={!prompt.trim() || status === 'queued' || status === 'processing'}>
            {(status === 'queued' || status === 'processing')
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={s.sendBtnText}>▶</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#0d0d12' },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#2e2e3a' },
  backBtn:         { padding: 8, backgroundColor: '#1e1e28', borderRadius: 8 },
  backText:        { color: '#f0eee8', fontSize: 18, fontWeight: '600' },
  headerCenter:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot:             { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3a3a48' },
  dotActive:       { backgroundColor: '#7c6af7' },
  headerTitle:     { color: '#f0eee8', fontSize: 15, fontWeight: '600' },
  platformBadge:   { backgroundColor: '#1a2456', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  platformText:    { color: '#7c9af7', fontSize: 10, fontWeight: '600' },
  scroll:          { flex: 1 },
  canvas:          { margin: 16, height: 220, backgroundColor: '#18181f', borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2e2e3a', overflow: 'hidden' },
  placeholder:     { color: '#3a3a48', fontSize: 14 },
  loadingBox:      { alignItems: 'center', gap: 10 },
  loadingText:     { color: '#a99af7', fontSize: 14, fontWeight: '600' },
  timer:           { color: '#7c6af7', fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  loadingHint:     { color: '#4a4a58', fontSize: 12 },
  video:           { width: '100%', height: '100%' },
  failBox:         { alignItems: 'center', gap: 8, padding: 20 },
  failIcon:        { fontSize: 32 },
  failTitle:       { color: '#e07070', fontSize: 16, fontWeight: '600' },
  failMsg:         { color: '#6a6878', fontSize: 13, textAlign: 'center' },
  retryBtn:        { marginTop: 8 },
  retryText:       { color: '#7c6af7', fontSize: 14 },
  sectionLabel:    { color: '#6a6878', fontSize: 12, fontWeight: '600', marginHorizontal: 16, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.8 },
  optionRow:       { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 16 },
  optionBtn:       { flex: 1, paddingVertical: 10, backgroundColor: '#1e1e28', borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#2e2e3a' },
  optionBtnActive: { backgroundColor: '#2a2456', borderColor: '#7c6af7' },
  optionText:      { color: '#6a6878', fontSize: 13, fontWeight: '500' },
  optionTextActive:{ color: '#a99af7' },
  inputRow:        { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: 16, alignItems: 'flex-end' },
  input:           { flex: 1, backgroundColor: '#1e1e28', borderWidth: 1, borderColor: '#3a3a48', borderRadius: 12, padding: 14, color: '#f0eee8', fontSize: 14, maxHeight: 100 },
  sendBtn:         { width: 48, height: 48, backgroundColor: '#7c6af7', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText:     { color: '#fff', fontSize: 18, fontWeight: '700' },
})
