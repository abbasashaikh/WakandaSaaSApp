// src/screens/VideoGenerationScreen.js
import React, { useState, useRef } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, SafeAreaView, StatusBar, ActivityIndicator,
  Alert, Image, Modal, TouchableWithoutFeedback,
} from 'react-native'
import Video from 'react-native-video'
import { launchImageLibrary } from 'react-native-image-picker'
import { generateVideo, startPolling, friendlyError } from '../api'
import { useAppStore } from '../store/appStore'

// ── Constants ─────────────────────────────────────────────────
const DURATIONS = ['4s', '6s', '8s']
const QUALITIES  = ['fast', 'quality']
const CREDIT_COST = { '4s': 5, '6s': 8, '8s': 10 }

// ── Image picker helper ───────────────────────────────────────
// Returns { uri, type, fileName } or null on cancel/error
function pickImage(callback) {
  launchImageLibrary(
    {
      mediaType:   'photo',
      quality:     0.85,
      maxWidth:    1920,
      maxHeight:   1920,
      includeBase64: false,
    },
    (response) => {
      if (response.didCancel || response.errorCode) { callback(null); return }
      const asset = response.assets?.[0]
      if (!asset?.uri) { callback(null); return }
      callback({
        uri:      asset.uri,
        type:     asset.type || 'image/jpeg',
        fileName: asset.fileName || `frame_${Date.now()}.jpg`,
      })
    }
  )
}

// ── FrameSlot — upload slot for start/end frames ──────────────
function FrameSlot({ label, asset, onUpload, onClear, disabled }) {
  return (
    <View style={fs.slot}>
      <View style={fs.slotHeader}>
        <Text style={fs.slotLabel}>{label}</Text>
        {asset && (
          <TouchableOpacity onPress={onClear} disabled={disabled}>
            <Text style={fs.clearBtn}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
      <TouchableOpacity
        style={[fs.slotBtn, asset && fs.slotBtnFilled]}
        onPress={onUpload}
        disabled={disabled}
        activeOpacity={0.7}
      >
        {asset
          ? <Image source={{ uri: asset.uri }} style={fs.slotThumb} />
          : <View style={fs.slotEmpty}>
              <Text style={fs.slotPlus}>+</Text>
              <Text style={fs.slotHint}>Upload</Text>
            </View>
        }
      </TouchableOpacity>
    </View>
  )
}

const fs = StyleSheet.create({
  slot:         { flex: 1 },
  slotHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  slotLabel:    { color: '#7c6af7', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  clearBtn:     { color: '#e07070', fontSize: 13, paddingHorizontal: 4 },
  slotBtn:      { height: 70, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#3a3a4a', backgroundColor: '#18181f', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  slotBtnFilled:{ borderStyle: 'solid', borderColor: '#7c6af7' },
  slotThumb:    { width: '100%', height: '100%', resizeMode: 'cover' },
  slotEmpty:    { alignItems: 'center', gap: 2 },
  slotPlus:     { color: '#4a4a5a', fontSize: 22, lineHeight: 24 },
  slotHint:     { color: '#4a4a5a', fontSize: 10 },
})

// ── SettingsPanel — matching Electron's Google Flow style ─────
function SettingsPanel({
  visible, onClose,
  duration, setDuration,
  subTab, setSubTab,
  startFrame, endFrame, ingredient,
  onUploadStart, onUploadEnd, onUploadIngredient,
  onClearStart, onClearEnd, onClearIngredient,
  disabled,
}) {
  const credits = CREDIT_COST[duration] || 10

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={p.overlay} />
      </TouchableWithoutFeedback>

      <View style={p.panel}>
        {/* Drag handle */}
        <View style={p.handle} />

        {/* Image | Video tabs — Video always active */}
        <View style={p.modeTabs}>
          <View style={p.modeTabInactive}>
            <Text style={p.modeTabInactiveText}>🖼 Image</Text>
          </View>
          <View style={p.modeTabActive}>
            <Text style={p.modeTabActiveText}>▶ Video</Text>
          </View>
        </View>

        {/* Frames | Ingredients sub-tabs */}
        <View style={p.subTabs}>
          {['frames', 'ingredients'].map(tab => (
            <TouchableOpacity
              key={tab}
              style={[p.subTab, subTab === tab && p.subTabActive]}
              onPress={() => setSubTab(tab)}
            >
              <Text style={[p.subTabText, subTab === tab && p.subTabTextActive]}>
                {tab === 'frames' ? '⊡  Frames' : '⟲  Ingredients'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Frames content */}
        {subTab === 'frames' && (
          <View style={p.frameRow}>
            <FrameSlot
              label="Start"
              asset={startFrame}
              onUpload={onUploadStart}
              onClear={onClearStart}
              disabled={disabled}
            />
            {/* Swap arrow */}
            <TouchableOpacity
              style={p.swapBtn}
              onPress={() => {
                // swap is handled in parent
                onUploadStart('_swap')
              }}
              disabled={disabled || (!startFrame && !endFrame)}
            >
              <Text style={p.swapIcon}>⇄</Text>
            </TouchableOpacity>
            <FrameSlot
              label="End"
              asset={endFrame}
              onUpload={onUploadEnd}
              onClear={onClearEnd}
              disabled={disabled}
            />
          </View>
        )}

        {/* Ingredients content */}
        {subTab === 'ingredients' && (
          <View style={p.ingSection}>
            <View style={p.ingHeader}>
              <Text style={p.ingLabel}>Reference image for video</Text>
              {ingredient && (
                <TouchableOpacity onPress={onClearIngredient} disabled={disabled}>
                  <Text style={p.clearBtn}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity
              style={[p.ingSlot, ingredient && p.ingSlotFilled]}
              onPress={onUploadIngredient}
              disabled={disabled}
              activeOpacity={0.7}
            >
              {ingredient
                ? <Image source={{ uri: ingredient.uri }} style={p.ingThumb} />
                : <View style={p.ingEmpty}>
                    <Text style={p.ingPlus}>+</Text>
                    <Text style={p.ingHint}>Click to upload</Text>
                  </View>
              }
            </TouchableOpacity>
          </View>
        )}

        {/* Duration: 4s | 6s | 8s */}
        <Text style={p.sectionLabel}>Duration</Text>
        <View style={p.durationRow}>
          {DURATIONS.map(d => (
            <TouchableOpacity
              key={d}
              style={[p.durBtn, duration === d && p.durBtnActive]}
              onPress={() => setDuration(d)}
              disabled={disabled}
            >
              <Text style={[p.durText, duration === d && p.durTextActive]}>{d}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* x1 multiplier (display only) */}
        <View style={p.multiplierRow}>
          <View style={p.multiplierBadge}>
            <Text style={p.multiplierText}>1x</Text>
          </View>
        </View>

        {/* Model (display only) */}
        <View style={p.modelRow}>
          <Text style={p.modelText}>Veo 3.1 - Fast</Text>
          <Text style={p.modelArrow}>▾</Text>
        </View>

        {/* Credits */}
        <Text style={p.creditsText}>
          Generating will use{' '}
          <Text style={p.creditsNum}>{credits} credits</Text>
        </Text>

        {/* Close button */}
        <TouchableOpacity style={p.closeBtn} onPress={onClose}>
          <Text style={p.closeBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  )
}

const p = StyleSheet.create({
  overlay:            { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  panel:              { backgroundColor: '#1a1a24', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36, gap: 14 },
  handle:             { width: 36, height: 4, borderRadius: 2, backgroundColor: '#3a3a48', alignSelf: 'center', marginBottom: 4 },
  modeTabs:           { flexDirection: 'row', gap: 8, marginBottom: 4 },
  modeTabActive:      { flex: 1, backgroundColor: 'rgba(124,106,247,0.2)', borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(124,106,247,0.5)' },
  modeTabActiveText:  { color: '#a99af7', fontSize: 13, fontWeight: '600' },
  modeTabInactive:    { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  modeTabInactiveText:{ color: '#4a4a5a', fontSize: 13 },
  subTabs:            { flexDirection: 'row', backgroundColor: '#111118', borderRadius: 10, padding: 4, gap: 4 },
  subTab:             { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  subTabActive:       { backgroundColor: '#fff' },
  subTabText:         { color: '#6a6878', fontSize: 12, fontWeight: '500' },
  subTabTextActive:   { color: '#111', fontWeight: '700' },
  frameRow:           { flexDirection: 'row', gap: 12, alignItems: 'flex-end' },
  swapBtn:            { paddingHorizontal: 6, paddingBottom: 8, opacity: 0.7 },
  swapIcon:           { color: '#a99af7', fontSize: 22 },
  ingSection:         { gap: 8 },
  ingHeader:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ingLabel:           { color: '#7c6af7', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  clearBtn:           { color: '#e07070', fontSize: 13, paddingHorizontal: 4 },
  ingSlot:            { height: 90, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#3a3a4a', backgroundColor: '#18181f', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  ingSlotFilled:      { borderStyle: 'solid', borderColor: '#7c6af7' },
  ingThumb:           { width: '100%', height: '100%', resizeMode: 'cover' },
  ingEmpty:           { alignItems: 'center', gap: 4 },
  ingPlus:            { color: '#4a4a5a', fontSize: 28 },
  ingHint:            { color: '#4a4a5a', fontSize: 11 },
  sectionLabel:       { color: '#6a6878', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  durationRow:        { flexDirection: 'row', gap: 8 },
  durBtn:             { flex: 1, paddingVertical: 10, backgroundColor: '#111118', borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: '#2e2e3a' },
  durBtnActive:       { backgroundColor: 'rgba(124,106,247,0.3)', borderColor: '#7c6af7' },
  durText:            { color: '#4a4a5a', fontSize: 13, fontWeight: '600' },
  durTextActive:      { color: '#a99af7' },
  multiplierRow:      { flexDirection: 'row' },
  multiplierBadge:    { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 },
  multiplierText:     { color: '#ccc', fontSize: 13, fontWeight: '600' },
  modelRow:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#111118', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  modelText:          { color: '#ccc', fontSize: 13 },
  modelArrow:         { color: '#6a6878', fontSize: 13 },
  creditsText:        { color: '#6a6878', fontSize: 12, textAlign: 'center' },
  creditsNum:         { color: '#ccc', textDecorationLine: 'underline' },
  closeBtn:           { backgroundColor: '#7c6af7', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  closeBtnText:       { color: '#fff', fontSize: 15, fontWeight: '700' },
})

// ── Main Screen ───────────────────────────────────────────────

export default function VideoGenerationScreen({ navigation }) {
  const addJob         = useAppStore(s => s.addJob)
  const updateJob      = useAppStore(s => s.updateJob)
  const prependHistory = useAppStore(s => s.prependHistory)

  // ── Generation state ────────────────────────────────────────
  const [prompt,   setPrompt]   = useState('')
  const [duration, setDuration] = useState('8s')
  const [quality,  setQuality]  = useState('fast')
  const [status,   setStatus]   = useState('idle')
  const [outputUrl, setUrl]     = useState(null)
  const [errorMsg,  setError]   = useState('')
  const [elapsed,   setElapsed] = useState(0)

  // ── Panel state ─────────────────────────────────────────────
  const [showPanel, setShowPanel] = useState(false)
  const [subTab,    setSubTab]    = useState('frames')

  // ── Frame state ─────────────────────────────────────────────
  // Storing { uri, type, fileName } objects — NOT File objects (React Native)
  const [startFrame,  setStartFrame]  = useState(null)
  const [endFrame,    setEndFrame]    = useState(null)
  const [ingredient,  setIngredient]  = useState(null)

  const stopRef  = useRef(null)
  const timerRef = useRef(null)

  // ── Timer helpers ────────────────────────────────────────────
  function startTimer() {
    setElapsed(0)
    timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000)
  }
  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }

  // ── Frame upload helpers ─────────────────────────────────────
  function handleUploadStart(special) {
    if (special === '_swap') {
      // Swap start <-> end
      const tmp = startFrame
      setStartFrame(endFrame)
      setEndFrame(tmp)
      return
    }
    pickImage(asset => { if (asset) setStartFrame(asset) })
  }

  function handleUploadEnd() {
    pickImage(asset => { if (asset) setEndFrame(asset) })
  }

  function handleUploadIngredient() {
    pickImage(asset => { if (asset) setIngredient(asset) })
  }

  // ── Generate ─────────────────────────────────────────────────
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
      const res = await generateVideo(trimmed, {
        duration,
        quality,
        start_frame:     startFrame   || undefined,
        end_frame:       endFrame     || undefined,
        reference_image: ingredient   || undefined,
      })
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
          // Clear frames after successful generation
          setStartFrame(null)
          setEndFrame(null)
          setIngredient(null)
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
    setStartFrame(null)
    setEndFrame(null)
    setIngredient(null)
  }

  const mins = Math.floor(elapsed / 60)
  const secs = String(elapsed % 60).padStart(2, '0')
  const isGenerating = status === 'queued' || status === 'processing'
  const hasFrames = !!(startFrame || endFrame || ingredient)

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0d0d12" />

      {/* Settings Panel Modal */}
      <SettingsPanel
        visible={showPanel}
        onClose={() => setShowPanel(false)}
        duration={duration}
        setDuration={setDuration}
        subTab={subTab}
        setSubTab={setSubTab}
        startFrame={startFrame}
        endFrame={endFrame}
        ingredient={ingredient}
        onUploadStart={handleUploadStart}
        onUploadEnd={handleUploadEnd}
        onUploadIngredient={handleUploadIngredient}
        onClearStart={() => setStartFrame(null)}
        onClearEnd={() => setEndFrame(null)}
        onClearIngredient={() => setIngredient(null)}
        disabled={isGenerating}
      />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Text style={s.backText}>←</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <View style={[s.dot, isGenerating && s.dotActive]} />
          <Text style={s.headerTitle}>AI Video Generation</Text>
          {/* Frames badge */}
          {hasFrames && !isGenerating && (
            <View style={s.framesBadge}>
              <Text style={s.framesBadgeText}>
                {[startFrame && 'Start', endFrame && 'End', ingredient && 'Ref']
                  .filter(Boolean).join('+')}
              </Text>
            </View>
          )}
        </View>
        <View style={s.platformBadge}>
          <Text style={s.platformText}>Android</Text>
        </View>
      </View>

      <ScrollView style={s.scroll} keyboardShouldPersistTaps="handled">

        {/* Preview / Canvas area */}
        <View style={s.canvas}>
          {status === 'idle' && !hasFrames && (
            <Text style={s.placeholder}>Your video will appear here</Text>
          )}

          {/* Show start/end thumbnails in idle state */}
          {status === 'idle' && hasFrames && (
            <View style={s.framePreview}>
              {startFrame && (
                <View style={s.framePreviewItem}>
                  <Text style={s.framePreviewLabel}>START</Text>
                  <Image source={{ uri: startFrame.uri }} style={s.framePreviewImg} />
                </View>
              )}
              {(startFrame || endFrame) && (
                <Text style={s.frameArrow}>→</Text>
              )}
              {endFrame && (
                <View style={s.framePreviewItem}>
                  <Text style={s.framePreviewLabel}>END</Text>
                  <Image source={{ uri: endFrame.uri }} style={s.framePreviewImg} />
                </View>
              )}
            </View>
          )}

          {/* Loading state — show frame thumbnails above progress */}
          {isGenerating && (
            <View style={s.loadingBox}>
              {hasFrames && (
                <View style={s.framePreviewSmall}>
                  {startFrame && <Image source={{ uri: startFrame.uri }} style={s.frameThumbSmall} />}
                  {(startFrame || endFrame) && <Text style={s.frameArrowSmall}>→</Text>}
                  {endFrame && <Image source={{ uri: endFrame.uri }} style={s.frameThumbSmall} />}
                </View>
              )}
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

        {/* Quality selector */}
        <Text style={s.sectionLabel}>Quality</Text>
        <View style={s.optionRow}>
          {QUALITIES.map(q => (
            <TouchableOpacity
              key={q}
              style={[s.optionBtn, quality === q && s.optionBtnActive]}
              onPress={() => setQuality(q)}
              disabled={isGenerating}
            >
              <Text style={[s.optionText, quality === q && s.optionTextActive]}>
                {q === 'fast' ? '⚡ Fast' : '✨ Quality'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Prompt + controls row */}
        <View style={s.inputRow}>
          {/* + button — opens settings panel */}
          <TouchableOpacity
            style={[s.plusBtn, hasFrames && s.plusBtnActive]}
            onPress={() => setShowPanel(true)}
            disabled={isGenerating}
            activeOpacity={0.7}
          >
            {(startFrame || endFrame || ingredient)
              ? <Image
                  source={{ uri: (startFrame || endFrame || ingredient).uri }}
                  style={s.plusThumb}
                />
              : <Text style={s.plusText}>+</Text>
            }
          </TouchableOpacity>

          <TextInput
            style={s.input}
            value={prompt}
            onChangeText={setPrompt}
            placeholder={hasFrames ? 'Describe the motion…' : 'Describe the video you want…'}
            placeholderTextColor="#4a4a5a"
            multiline
            maxLength={500}
            editable={!isGenerating}
          />

          <TouchableOpacity
            style={[s.sendBtn, (!prompt.trim() || isGenerating) && s.sendBtnDisabled]}
            onPress={handleGenerate}
            disabled={!prompt.trim() || isGenerating}
          >
            {isGenerating
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={s.sendBtnText}>▶</Text>
            }
          </TouchableOpacity>
        </View>

        <Text style={s.hint}>
          + for frames &amp; ingredients · {duration} · {quality}
        </Text>

      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#0d0d12' },
  header:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#2e2e3a' },
  backBtn:            { padding: 8, backgroundColor: '#1e1e28', borderRadius: 8 },
  backText:           { color: '#f0eee8', fontSize: 18, fontWeight: '600' },
  headerCenter:       { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, marginHorizontal: 8 },
  dot:                { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3a3a48' },
  dotActive:          { backgroundColor: '#7c6af7' },
  headerTitle:        { color: '#f0eee8', fontSize: 15, fontWeight: '600' },
  framesBadge:        { backgroundColor: 'rgba(124,106,247,0.2)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  framesBadgeText:    { color: '#a99af7', fontSize: 10, fontWeight: '600' },
  platformBadge:      { backgroundColor: '#1a2456', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  platformText:       { color: '#7c9af7', fontSize: 10, fontWeight: '600' },
  scroll:             { flex: 1 },

  // Canvas
  canvas:             { margin: 16, minHeight: 220, backgroundColor: '#18181f', borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2e2e3a', overflow: 'hidden', padding: 16 },
  placeholder:        { color: '#3a3a48', fontSize: 14 },

  // Frame preview in idle state
  framePreview:       { flexDirection: 'row', alignItems: 'center', gap: 12 },
  framePreviewItem:   { alignItems: 'center', gap: 4 },
  framePreviewLabel:  { color: '#7c6af7', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  framePreviewImg:    { width: 80, height: 56, borderRadius: 8, borderWidth: 1.5, borderColor: 'rgba(124,106,247,0.5)' },
  frameArrow:         { color: 'rgba(124,106,247,0.4)', fontSize: 20 },

  // Loading state
  loadingBox:         { alignItems: 'center', gap: 10, width: '100%' },
  framePreviewSmall:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  frameThumbSmall:    { width: 48, height: 34, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(124,106,247,0.5)' },
  frameArrowSmall:    { color: 'rgba(124,106,247,0.4)', fontSize: 14 },
  loadingText:        { color: '#a99af7', fontSize: 14, fontWeight: '600' },
  timer:              { color: '#7c6af7', fontSize: 28, fontWeight: '700' },
  loadingHint:        { color: '#4a4a58', fontSize: 12 },

  video:              { width: '100%', height: 200 },

  // Fail state
  failBox:            { alignItems: 'center', gap: 8 },
  failIcon:           { fontSize: 32 },
  failTitle:          { color: '#e07070', fontSize: 16, fontWeight: '600' },
  failMsg:            { color: '#6a6878', fontSize: 13, textAlign: 'center' },
  retryBtn:           { marginTop: 8 },
  retryText:          { color: '#7c6af7', fontSize: 14 },

  sectionLabel:       { color: '#6a6878', fontSize: 12, fontWeight: '600', marginHorizontal: 16, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.8 },
  optionRow:          { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 16 },
  optionBtn:          { flex: 1, paddingVertical: 10, backgroundColor: '#1e1e28', borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#2e2e3a' },
  optionBtnActive:    { backgroundColor: '#2a2456', borderColor: '#7c6af7' },
  optionText:         { color: '#6a6878', fontSize: 13, fontWeight: '500' },
  optionTextActive:   { color: '#a99af7' },

  // Input row
  inputRow:           { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: 8, alignItems: 'flex-end' },
  plusBtn:            { width: 48, height: 48, backgroundColor: '#1e1e28', borderRadius: 12, borderWidth: 1, borderColor: '#3a3a48', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  plusBtnActive:      { borderColor: '#7c6af7', backgroundColor: 'rgba(124,106,247,0.15)' },
  plusThumb:          { width: '100%', height: '100%', resizeMode: 'cover' },
  plusText:           { color: '#6a6878', fontSize: 24, lineHeight: 28 },
  input:              { flex: 1, backgroundColor: '#1e1e28', borderWidth: 1, borderColor: '#3a3a48', borderRadius: 12, padding: 14, color: '#f0eee8', fontSize: 14, maxHeight: 100 },
  sendBtn:            { width: 48, height: 48, backgroundColor: '#7c6af7', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled:    { opacity: 0.4 },
  sendBtnText:        { color: '#fff', fontSize: 18, fontWeight: '700' },
  hint:               { color: '#3a3a48', fontSize: 11, textAlign: 'center', paddingBottom: 16 },
})
