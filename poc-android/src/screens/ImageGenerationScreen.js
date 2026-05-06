// src/screens/ImageGenerationScreen.js
import React, { useState, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, SafeAreaView, StatusBar, ActivityIndicator,
  Image, Dimensions, Alert,
} from 'react-native'
import { generateImage, startPolling, friendlyError } from '../api'
import { useAppStore } from '../store/appStore'

const RATIOS = ['16:9', '1:1', '9:16', '4:3']
const { width: SCREEN_W } = Dimensions.get('window')

export default function ImageGenerationScreen({ navigation }) {
  const addJob         = useAppStore(s => s.addJob)
  const updateJob      = useAppStore(s => s.updateJob)
  const prependHistory = useAppStore(s => s.prependHistory)

  const [prompt, setPrompt]   = useState('')
  const [ratio, setRatio]     = useState('16:9')
  const [status, setStatus]   = useState('idle')   // idle|queued|processing|completed|failed
  const [outputUrl, setUrl]   = useState(null)
  const [errorMsg, setError]  = useState('')
  const stopRef = useRef(null)

  async function handleGenerate() {
    const trimmed = prompt.trim()
    if (!trimmed) {
      Alert.alert('Enter a prompt', 'Please describe what you want to generate.')
      return
    }
    setStatus('queued')
    setUrl(null)
    setError('')
    stopRef.current?.()

    try {
      const res = await generateImage(trimmed, { aspect_ratio: ratio })
      const jobId = res.job_id
      addJob({ job_id: jobId, status: 'queued', prompt: trimmed, type: 'image' })

      stopRef.current = startPolling(jobId, {
        onProgress: (job) => {
          setStatus(job.status)
          updateJob(jobId, job)
        },
        onComplete: (job) => {
          setStatus('completed')
          setUrl(job.output_url)
          prependHistory({ ...job, prompt: trimmed })
          stopRef.current?.()
        },
        onError: (msg) => {
          setStatus('failed')
          setError(msg)
          stopRef.current?.()
        },
      })
    } catch (err) {
      setStatus('failed')
      setError(friendlyError(err.message))
    }
  }

  function handleReset() {
    stopRef.current?.()
    setStatus('idle')
    setUrl(null)
    setError('')
  }

  const imgHeight = SCREEN_W * (ratio === '1:1' ? 1 : ratio === '9:16' ? 16/9 : ratio === '4:3' ? 3/4 : 9/16)

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
          <Text style={s.headerTitle}>AI Image Generation</Text>
        </View>
        <View style={s.platformBadge}>
          <Text style={s.platformText}>Android</Text>
        </View>
      </View>

      <ScrollView style={s.scroll} keyboardShouldPersistTaps="handled">
        {/* Canvas / Result area */}
        <View style={[s.canvas, { height: Math.min(imgHeight, 400) }]}>
          {status === 'idle' && (
            <Text style={s.placeholder}>Your image will appear here</Text>
          )}
          {(status === 'queued' || status === 'processing') && (
            <View style={s.loadingBox}>
              <ActivityIndicator size="large" color="#7c6af7" />
              <Text style={s.loadingText}>
                {status === 'queued' ? 'Queued…' : 'Generating image…'}
              </Text>
              <Text style={s.loadingHint}>This takes 30–90 seconds</Text>
            </View>
          )}
          {status === 'completed' && outputUrl && (
            <Image
              source={{ uri: outputUrl }}
              style={s.resultImage}
              resizeMode="contain"
            />
          )}
          {status === 'failed' && (
            <View style={s.failBox}>
              <Text style={s.failIcon}>⚠️</Text>
              <Text style={s.failTitle}>Generation failed</Text>
              <Text style={s.failMsg}>{errorMsg}</Text>
              <TouchableOpacity style={s.retryBtn} onPress={handleReset}>
                <Text style={s.retryText}>Try again</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Aspect ratio selector */}
        <View style={s.ratioRow}>
          {RATIOS.map(r => (
            <TouchableOpacity
              key={r}
              style={[s.ratioBtn, ratio === r && s.ratioBtnActive]}
              onPress={() => setRatio(r)}>
              <Text style={[s.ratioText, ratio === r && s.ratioTextActive]}>{r}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Prompt input */}
        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            value={prompt}
            onChangeText={setPrompt}
            placeholder="Describe the image you want…"
            placeholderTextColor="#4a4a5a"
            multiline
            maxLength={500}
            returnKeyType="default"
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
  canvas:          { margin: 16, backgroundColor: '#18181f', borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2e2e3a' },
  placeholder:     { color: '#3a3a48', fontSize: 14 },
  loadingBox:      { alignItems: 'center', gap: 12 },
  loadingText:     { color: '#a99af7', fontSize: 14, fontWeight: '600' },
  loadingHint:     { color: '#4a4a58', fontSize: 12 },
  resultImage:     { width: '100%', height: '100%' },
  failBox:         { alignItems: 'center', gap: 8, padding: 20 },
  failIcon:        { fontSize: 32 },
  failTitle:       { color: '#e07070', fontSize: 16, fontWeight: '600' },
  failMsg:         { color: '#6a6878', fontSize: 13, textAlign: 'center' },
  retryBtn:        { marginTop: 8 },
  retryText:       { color: '#7c6af7', fontSize: 14 },
  ratioRow:        { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  ratioBtn:        { flex: 1, paddingVertical: 8, backgroundColor: '#1e1e28', borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#2e2e3a' },
  ratioBtnActive:  { backgroundColor: '#2a2456', borderColor: '#7c6af7' },
  ratioText:       { color: '#6a6878', fontSize: 12, fontWeight: '500' },
  ratioTextActive: { color: '#a99af7' },
  inputRow:        { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: 16, alignItems: 'flex-end' },
  input:           { flex: 1, backgroundColor: '#1e1e28', borderWidth: 1, borderColor: '#3a3a48', borderRadius: 12, padding: 14, color: '#f0eee8', fontSize: 14, maxHeight: 100 },
  sendBtn:         { width: 48, height: 48, backgroundColor: '#7c6af7', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText:     { color: '#fff', fontSize: 18, fontWeight: '700' },
})
