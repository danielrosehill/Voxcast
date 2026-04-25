import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, ScrollView, TextInput,
  Modal, Alert, Share, ActivityIndicator, Linking, Platform, Pressable, Switch,
} from 'react-native';
import { Audio } from 'expo-av';
import * as Clipboard from 'expo-clipboard';
import {
  MODES, GROUPS, TABS, parseEmailOutput,
  resolveMode, fullLabelFor, searchLibrary, isLibraryMode,
} from './src/modes';
import { transcribeAndTransform } from './src/api';
import {
  getApiKey, setApiKey, clearApiKey,
  getSettings, setSettings,
  getHistory, pushHistory, clearHistory,
} from './src/storage';

const COLORS = {
  bg: '#0f172a',
  panel: '#1e293b',
  panelAlt: '#293548',
  border: '#334155',
  text: '#e2e8f0',
  textDim: '#94a3b8',
  textMuted: '#64748b',
  accent: '#6366f1',
  accentDim: '#4f46e5',
  success: '#10b981',
  danger: '#ef4444',
  warn: '#f59e0b',
};

export default function App() {
  const [apiKey, setApiKeyState] = useState(null);
  const [settings, setSettingsState] = useState(null);
  const [history, setHistory] = useState([]);

  const [recipient, setRecipient] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [resultMode, setResultMode] = useState(null);
  const [emailParts, setEmailParts] = useState({ subject: '', body: '' });
  const [lastPayload, setLastPayload] = useState(null);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const tickRef = useRef(null);

  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showModes, setShowModes] = useState(false);

  // Recording state: 'idle' | 'recording' | 'paused'
  const [recState, setRecState] = useState('idle');
  const [clips, setClips] = useState([]);
  const recRef = useRef(null);
  const [justCopied, setJustCopied] = useState(false);

  useEffect(() => { (async () => {
    setApiKeyState(await getApiKey());
    const s = await getSettings();
    // If "Remember Last Preset" is off, force a fresh pick this session.
    const sessionSettings = s.rememberLastPreset ? s : { ...s, activeMode: null };
    setSettingsState(sessionSettings);
    setHistory(await getHistory());
    await Audio.requestPermissionsAsync();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    if (!sessionSettings.activeMode) setShowModes(true);
  })(); }, []);

  useEffect(() => {
    if (recState === 'recording') {
      tickRef.current = setInterval(() => setRecordSeconds(s => s + 1), 1000);
    } else if (tickRef.current) {
      clearInterval(tickRef.current); tickRef.current = null;
    }
    return () => tickRef.current && clearInterval(tickRef.current);
  }, [recState]);

  if (!settings) return <View style={styles.loadingRoot}><ActivityIndicator color={COLORS.accent} /></View>;

  const activeMode = settings.activeMode || null;
  const activeModeDef = activeMode ? resolveMode(activeMode) : null;
  const isEmailMode = activeModeDef?.output === 'email';

  async function selectMode(key) {
    const next = { ...settings, activeMode: key };
    setSettingsState(next);
    // Persist only if remember is on; otherwise keep storage's last value untouched.
    if (next.rememberLastPreset) await setSettings(next);
    setShowModes(false);
  }

  // ---------- Recording state machine ----------

  async function startNewClip({ keepClips = true } = {}) {
    try {
      setResult(''); setEmailParts({ subject: '', body: '' }); setJustCopied(false);
      if (!keepClips) setClips([]);
      setRecordSeconds(0);
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      recRef.current = rec;
      setRecState('recording');
    } catch (e) { Alert.alert('Record error', String(e.message || e)); }
  }

  async function stopCurrentClip() {
    const rec = recRef.current;
    recRef.current = null;
    if (!rec) { setRecState('idle'); return null; }
    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      if (uri) setClips(prev => [...prev, uri]);
      setRecState('idle');
      return uri;
    } catch (e) {
      Alert.alert('Stop error', String(e.message || e));
      setRecState('idle');
      return null;
    }
  }

  // Tap-tap primary action (state-driven)
  async function tapPrimary() {
    if (!apiKey) { Alert.alert('No API key', 'Add your OpenRouter key in Settings.'); return; }
    if (!activeMode) { setShowModes(true); return; }
    if (loading) return;
    if (recState === 'idle') {
      await startNewClip({ keepClips: clips.length > 0 });
      return;
    }
    if (recState === 'recording') {
      await stopCurrentClip();
      return;
    }
    if (recState === 'paused') {
      try {
        await recRef.current?.startAsync();
        setRecState('recording');
      } catch (e) { Alert.alert('Resume error', String(e.message || e)); }
    }
  }

  async function togglePause() {
    if (recState === 'recording') {
      try { await recRef.current?.pauseAsync(); setRecState('paused'); }
      catch (e) { Alert.alert('Pause error', String(e.message || e)); }
    } else if (recState === 'paused') {
      try { await recRef.current?.startAsync(); setRecState('recording'); }
      catch (e) { Alert.alert('Resume error', String(e.message || e)); }
    }
  }

  async function addClip() {
    if (recState !== 'idle' || loading) return;
    await startNewClip({ keepClips: true });
  }

  async function redoLast() {
    if (recState !== 'idle' || loading) return;
    setClips(prev => prev.slice(0, -1));
    setResult(''); setJustCopied(false);
  }

  async function deleteAll() {
    if (recRef.current) {
      try { await recRef.current.stopAndUnloadAsync(); } catch {}
      recRef.current = null;
    }
    setRecState('idle'); setClips([]); setRecordSeconds(0);
    setResult(''); setEmailParts({ subject: '', body: '' });
    setJustCopied(false); setLastPayload(null);
  }

  async function retakeAll() {
    await deleteAll();
    await startNewClip({ keepClips: false });
  }

  async function send() {
    if (!apiKey) { Alert.alert('No API key', 'Add your OpenRouter key in Settings.'); return; }
    if (loading) return;

    // If currently recording/paused, stop and capture the final clip first.
    let finalClips = clips;
    if (recState === 'recording' || recState === 'paused') {
      const rec = recRef.current;
      recRef.current = null;
      if (rec) {
        try {
          await rec.stopAndUnloadAsync();
          const uri = rec.getURI();
          if (uri) finalClips = [...clips, uri];
        } catch (e) { Alert.alert('Stop error', String(e.message || e)); return; }
      }
      setClips(finalClips);
      setRecState('idle');
    }

    if (!finalClips.length) { Alert.alert('Nothing to send', 'Record something first.'); return; }

    const payload = {
      audioUris: finalClips,
      mode: activeMode,
      userName: settings.userName,
      recipient,
      apiKey,
    };
    setLoading(true);
    try {
      const text = await transcribeAndTransform(payload);
      setResult(text);
      setResultMode(activeMode);
      setLastPayload(payload);

      if (activeModeDef.output === 'email') {
        const parts = parseEmailOutput(text);
        setEmailParts(parts);
        await Clipboard.setStringAsync(parts.body || text);
      } else {
        await Clipboard.setStringAsync(text);
      }
      setJustCopied(true);

      const entry = {
        id: Date.now(),
        mode: activeMode,
        text,
        ts: new Date().toISOString(),
        recipient: recipient || null,
      };
      setHistory(await pushHistory(entry));
    } catch (e) {
      Alert.alert('Transcription failed', String(e.message || e));
    } finally { setLoading(false); }
  }

  async function retryOnce() {
    if (!lastPayload) return;
    setLoading(true);
    try {
      const text = await transcribeAndTransform(lastPayload);
      setResult(text);
      setResultMode(lastPayload.mode);
      const rDef = resolveMode(lastPayload.mode);
      if (rDef?.output === 'email') {
        setEmailParts(parseEmailOutput(text));
      }
      const entry = {
        id: Date.now(),
        mode: lastPayload.mode,
        text,
        ts: new Date().toISOString(),
        recipient: lastPayload.recipient || null,
      };
      setHistory(await pushHistory(entry));
    } catch (e) { Alert.alert('Retry failed', String(e.message || e)); }
    finally { setLoading(false); }
  }

  async function copyText(text, label) {
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied', label ? `${label} copied to clipboard.` : 'Copied to clipboard.');
  }

  async function shareWhatsApp(text) {
    const url = `whatsapp://send?text=${encodeURIComponent(text)}`;
    const can = await Linking.canOpenURL(url);
    if (can) Linking.openURL(url);
    else Share.share({ message: text });
  }
  async function shareEmail(subject, body) {
    const url = `mailto:?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body || '')}`;
    const can = await Linking.canOpenURL(url);
    if (can) Linking.openURL(url);
    else Share.share({ message: `${subject ? subject + '\n\n' : ''}${body || ''}` });
  }
  async function shareGeneric(text) { Share.share({ message: text }); }

  const resultModeDef = resultMode ? resolveMode(resultMode) : null;
  const resultIsEmail = resultModeDef?.output === 'email';

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.brand}>Voxcast</Text>
          <Text style={styles.tagline}>Speak. Reshape. Send.</Text>
        </View>
        <View style={styles.headerBtns}>
          {(clips.length > 0 || result || recState !== 'idle') && (
            <IconBtn glyph="＋" label="New" onPress={deleteAll} accent />
          )}
          <IconBtn glyph="⟲" label="History" onPress={() => setShowHistory(true)} />
          <IconBtn glyph="⚙" label="Settings" onPress={() => setShowSettings(true)} />
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">

        <TouchableOpacity style={styles.modeCard} onPress={() => setShowModes(true)} activeOpacity={0.7}>
          <View style={{ flex: 1 }}>
            <Text style={styles.modeCardKicker}>PRESET</Text>
            <Text style={styles.modeCardTitle}>
              {activeMode ? fullLabelFor(activeMode) : 'Choose a preset'}
            </Text>
            <Text style={styles.modeCardDesc} numberOfLines={2}>
              {activeModeDef ? activeModeDef.description : 'Tap to pick the output style for this session.'}
            </Text>
          </View>
          <Text style={styles.modeCardChevron}>›</Text>
        </TouchableOpacity>

        {isEmailMode && (
          <View style={styles.recipientRow}>
            <Text style={styles.label}>To (optional)</Text>
            <TextInput
              style={styles.recipientInput}
              placeholder="Recipient name"
              placeholderTextColor={COLORS.textMuted}
              value={recipient}
              onChangeText={setRecipient}
            />
          </View>
        )}

        <View style={styles.recorderPanel}>

          <View style={styles.statusBar}>
            <View style={[
              styles.statusDot,
              recState === 'recording' && { backgroundColor: COLORS.danger },
              recState === 'paused' && { backgroundColor: COLORS.warn },
              recState === 'idle' && clips.length > 0 && { backgroundColor: COLORS.success },
            ]} />
            <Text style={styles.statusBarText}>
              {loading
                ? 'PROCESSING'
                : recState === 'recording'
                  ? 'RECORDING'
                  : recState === 'paused'
                    ? 'PAUSED'
                    : clips.length > 0
                      ? `READY · ${clips.length} CLIP${clips.length > 1 ? 'S' : ''}`
                      : justCopied
                        ? 'COPIED'
                        : 'STANDBY'}
            </Text>
            <Text style={styles.statusBarTime}>{formatTime(recordSeconds)}</Text>
          </View>

          <View style={styles.actionRowMain}>
            <Pressable
              onPress={tapPrimary}
              disabled={loading}
              style={({ pressed }) => [
                styles.recordPill,
                recState === 'recording' && styles.recordPillRecording,
                pressed && { opacity: 0.85 },
                loading && { opacity: 0.5 },
              ]}>
              <Text style={styles.recordPillGlyph}>
                {recState === 'recording' ? '■' : '●'}
              </Text>
              <Text style={styles.recordPillLabel}>
                {recState === 'recording' ? 'Stop' : 'Record'}
              </Text>
            </Pressable>

            <TouchableOpacity
              onPress={send}
              disabled={loading || (clips.length === 0 && recState === 'idle')}
              style={[
                styles.transcribePill,
                (loading || (clips.length === 0 && recState === 'idle')) && styles.transcribePillDisabled,
              ]}
              activeOpacity={0.85}>
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.transcribePillLabel}>Transcribe →</Text>
              )}
            </TouchableOpacity>
          </View>

        </View>

        {result ? (
          resultIsEmail ? (
            <View style={styles.resultCard}>
              <Text style={styles.resultKicker}>{fullLabelFor(resultMode)}</Text>

              <Text style={styles.fieldLabel}>Subject</Text>
              <View style={styles.fieldBox}>
                <Text style={styles.fieldText} selectable>{emailParts.subject || '—'}</Text>
              </View>
              <View style={styles.actionRow}>
                <ActionBtn label="Copy subject" onPress={() => copyText(emailParts.subject, 'Subject')} />
              </View>

              <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Body</Text>
              <View style={styles.fieldBox}>
                <Text style={styles.fieldText} selectable>{emailParts.body || '—'}</Text>
              </View>
              <View style={styles.actionRow}>
                <ActionBtn label="Copy body" onPress={() => copyText(emailParts.body, 'Body')} primary />
                <ActionBtn label="Email" onPress={() => shareEmail(emailParts.subject, emailParts.body)} />
                <ActionBtn label="Share" onPress={() => shareGeneric(`${emailParts.subject}\n\n${emailParts.body}`)} />
              </View>
              {lastPayload && (
                <View style={styles.actionRow}>
                  <ActionBtn label="Retry" onPress={retryOnce} subtle />
                </View>
              )}
            </View>
          ) : (
            <View style={styles.resultCard}>
              <Text style={styles.resultKicker}>{fullLabelFor(resultMode)}</Text>
              <View style={styles.fieldBox}>
                <Text style={styles.fieldText} selectable>{result}</Text>
              </View>
              <View style={styles.actionRow}>
                <ActionBtn label="Copy" onPress={() => copyText(result)} primary />
                <ActionBtn label="WhatsApp" onPress={() => shareWhatsApp(result)} />
                <ActionBtn label="Share" onPress={() => shareGeneric(result)} />
                {lastPayload && <ActionBtn label="Retry" onPress={retryOnce} subtle />}
              </View>
            </View>
          )
        ) : null}

      </ScrollView>

      <ModeSelectorModal
        visible={showModes}
        onClose={() => setShowModes(false)}
        activeMode={activeMode}
        onSelect={selectMode}
      />
      <SettingsModal
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        apiKey={apiKey}
        onSaveKey={async (v) => { await setApiKey(v); setApiKeyState(v); }}
        onClearKey={async () => { await clearApiKey(); setApiKeyState(null); }}
        settings={settings}
        onSaveSettings={async (s) => { setSettingsState(s); await setSettings(s); }}
      />
      <HistoryModal
        visible={showHistory}
        onClose={() => setShowHistory(false)}
        history={history}
        onClear={async () => { await clearHistory(); setHistory([]); }}
        onCopy={(t) => copyText(t)}
      />
    </View>
  );
}

function formatTime(s) {
  const m = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${m}:${ss}`;
}

function HeaderBtn({ label, onPress, green }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.headerBtn, green && styles.headerBtnGreen]}>
      <Text style={[styles.headerBtnText, green && styles.headerBtnTextGreen]}>{label}</Text>
    </TouchableOpacity>
  );
}

function IconBtn({ glyph, label, onPress, accent }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityLabel={label}
      style={[styles.iconBtn, accent && styles.iconBtnAccent]}
      activeOpacity={0.7}>
      <Text style={[styles.iconBtnGlyph, accent && styles.iconBtnGlyphAccent]}>{glyph}</Text>
    </TouchableOpacity>
  );
}

function ControlIcon({ glyph, label, onPress, disabled, danger }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      style={[styles.ctrlIcon, disabled && styles.ctrlIconDisabled]}>
      <View style={[
        styles.ctrlIconCircle,
        danger && !disabled && styles.ctrlIconCircleDanger,
      ]}>
        <Text style={[
          styles.ctrlIconGlyph,
          danger && !disabled && { color: COLORS.danger },
        ]}>{glyph}</Text>
      </View>
      <Text style={styles.ctrlIconLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function ActionBtn({ label, onPress, primary, subtle }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.actionBtn,
        primary && styles.actionBtnPrimary,
        subtle && styles.actionBtnSubtle,
      ]}>
      <Text style={[
        styles.actionBtnText,
        primary && styles.actionBtnTextPrimary,
        subtle && styles.actionBtnTextSubtle,
      ]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ModeSelectorModal({ visible, onClose, activeMode, onSelect }) {
  const [showLib, setShowLib] = useState(false);
  const [tab, setTab] = useState('general');
  const libraryActive = isLibraryMode(activeMode);

  // When opening, default to the tab containing the active mode.
  useEffect(() => {
    if (!visible) return;
    if (activeMode && !isLibraryMode(activeMode)) {
      const m = MODES[activeMode];
      const g = GROUPS.find(g => g.key === m?.group);
      if (g?.tab) setTab(g.tab);
    } else {
      setTab('general');
    }
  }, [visible, activeMode]);

  const visibleGroups = GROUPS.filter(g => g.tab === tab);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Choose a preset</Text>
          <TouchableOpacity onPress={onClose}><Text style={styles.modalClose}>Done</Text></TouchableOpacity>
        </View>

        <View style={styles.tabBar}>
          {TABS.map(t => (
            <TouchableOpacity
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[styles.tab, tab === t.key && styles.tabActive]}>
              <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
          {visibleGroups.map(group => (
            <View key={group.key} style={{ marginBottom: 22 }}>
              <Text style={styles.groupLabel}>{group.label.toUpperCase()}</Text>
              {group.modes.map(modeKey => {
                const m = MODES[modeKey];
                if (!m) return null;
                const active = modeKey === activeMode;
                return (
                  <TouchableOpacity
                    key={modeKey}
                    onPress={() => onSelect(modeKey)}
                    style={[styles.modeRow, active && styles.modeRowActive]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.modeRowLabel, active && styles.modeRowLabelActive]}>{m.label}</Text>
                      <Text style={styles.modeRowDesc}>{m.description}</Text>
                    </View>
                    {active && <Text style={styles.modeRowCheck}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}

          {tab === 'general' && (
            <>
              <Text style={styles.groupLabel}>LIBRARY</Text>
              <TouchableOpacity
                onPress={() => setShowLib(true)}
                style={[styles.modeRow, libraryActive && styles.modeRowActive]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.modeRowLabel, libraryActive && styles.modeRowLabelActive]}>
                    Browse library…
                  </Text>
                  <Text style={styles.modeRowDesc} numberOfLines={2}>
                    {libraryActive
                      ? `Active: ${resolveMode(activeMode)?.label || ''}`
                      : '200+ prompts from the Text-Transformation-Prompt-Library — search and pick.'}
                  </Text>
                </View>
                <Text style={styles.modeRowCheck}>›</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>

        <LibraryModal
          visible={showLib}
          onClose={() => setShowLib(false)}
          activeMode={activeMode}
          onSelect={(slug) => { setShowLib(false); onSelect('lib:' + slug); }}
        />
      </View>
    </Modal>
  );
}

function LibraryModal({ visible, onClose, activeMode, onSelect }) {
  const [query, setQuery] = useState('');
  const results = searchLibrary(query).slice(0, 200);
  const activeSlug = isLibraryMode(activeMode) ? activeMode.slice(4) : null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Library</Text>
          <TouchableOpacity onPress={onClose}><Text style={styles.modalClose}>Back</Text></TouchableOpacity>
        </View>
        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          <TextInput
            style={styles.input}
            placeholder="Search by name or description…"
            placeholderTextColor={COLORS.textMuted}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={[styles.hint, { marginBottom: 8 }]}>{results.length} prompt{results.length === 1 ? '' : 's'}</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 0, paddingBottom: 60 }}>
          {results.map(p => {
            const active = p.slug === activeSlug;
            return (
              <TouchableOpacity
                key={p.slug}
                onPress={() => onSelect(p.slug)}
                style={[styles.modeRow, active && styles.modeRowActive]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.modeRowLabel, active && styles.modeRowLabelActive]}>{p.name}</Text>
                  {p.description ? (
                    <Text style={styles.modeRowDesc} numberOfLines={3}>{p.description}</Text>
                  ) : null}
                </View>
                {active && <Text style={styles.modeRowCheck}>✓</Text>}
              </TouchableOpacity>
            );
          })}
          {results.length === 0 && (
            <Text style={[styles.hint, { textAlign: 'center', marginTop: 24 }]}>No matches.</Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function SettingsModal({ visible, onClose, apiKey, onSaveKey, onClearKey, settings, onSaveSettings }) {
  const [keyInput, setKeyInput] = useState('');
  const [name, setName] = useState(settings.userName || '');
  const [remember, setRemember] = useState(!!settings.rememberLastPreset);
  useEffect(() => {
    setName(settings.userName || '');
    setRemember(!!settings.rememberLastPreset);
    setKeyInput('');
  }, [settings, visible]);

  async function save() {
    const next = { ...settings, userName: name.trim(), rememberLastPreset: remember };
    await onSaveSettings(next);
    if (keyInput.trim()) { await onSaveKey(keyInput.trim()); }
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Settings</Text>
          <TouchableOpacity onPress={onClose}><Text style={styles.modalClose}>Cancel</Text></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>

          <Text style={styles.sectionLabel}>Your name</Text>
          <Text style={styles.hint}>Used as context — you are the sender, never the recipient.</Text>
          <TextInput
            style={styles.input}
            placeholder="Daniel"
            placeholderTextColor={COLORS.textMuted}
            value={name}
            onChangeText={setName}
          />

          <Text style={styles.sectionLabel}>OpenRouter API key</Text>
          <Text style={styles.hint}>{apiKey ? 'Key saved. Enter a new one to replace.' : 'Required for transcription.'}</Text>
          <TextInput
            style={styles.input}
            placeholder="sk-or-v1-…"
            placeholderTextColor={COLORS.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={keyInput}
            onChangeText={setKeyInput}
          />
          {apiKey ? (
            <TouchableOpacity style={[styles.actionBtn, styles.actionBtnDanger, { alignSelf: 'flex-start' }]} onPress={onClearKey}>
              <Text style={[styles.actionBtnText, { color: '#fff' }]}>Clear saved key</Text>
            </TouchableOpacity>
          ) : null}

          <Text style={styles.sectionLabel}>Behavior</Text>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Remember last preset</Text>
              <Text style={styles.hint}>If off, you'll be prompted to choose a preset on every launch.</Text>
            </View>
            <Switch
              value={remember}
              onValueChange={setRemember}
              trackColor={{ true: COLORS.accent, false: COLORS.border }}
              thumbColor="#fff"
            />
          </View>

          <View style={{ height: 28 }} />
          <TouchableOpacity style={[styles.actionBtn, styles.actionBtnPrimary]} onPress={save}>
            <Text style={[styles.actionBtnText, styles.actionBtnTextPrimary]}>Save</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

function HistoryModal({ visible, onClose, history, onClear, onCopy }) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>History</Text>
          <TouchableOpacity onPress={onClose}><Text style={styles.modalClose}>Close</Text></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
          {history.length === 0 && <Text style={styles.hint}>No entries yet.</Text>}
          {history.map(h => {
            return (
              <View key={h.id} style={styles.histItem}>
                <Text style={styles.histMeta}>
                  {fullLabelFor(h.mode)}
                  {h.recipient ? `  ·  → ${h.recipient}` : ''}
                  {'  ·  '}{new Date(h.ts).toLocaleString()}
                </Text>
                <Text style={styles.histText} numberOfLines={6}>{h.text}</Text>
                <View style={styles.actionRow}>
                  <ActionBtn label="Copy" onPress={() => onCopy(h.text)} />
                </View>
              </View>
            );
          })}
          {history.length > 0 && (
            <TouchableOpacity style={[styles.actionBtn, styles.actionBtnDanger, { alignSelf: 'flex-start', marginTop: 12 }]} onPress={onClear}>
              <Text style={[styles.actionBtnText, { color: '#fff' }]}>Clear history</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const sysFont = Platform.OS === 'ios' ? undefined : 'sans-serif';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg, paddingTop: Platform.OS === 'android' ? 36 : 50 },
  loadingRoot: { flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  brand: { color: COLORS.text, fontSize: 24, fontWeight: '700', letterSpacing: 0.3, fontFamily: sysFont },
  tagline: { color: COLORS.textMuted, fontSize: 12, marginTop: 2, fontFamily: sysFont },
  headerBtns: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  headerBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: COLORS.panel, borderWidth: 1, borderColor: COLORS.border },
  headerBtnText: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
  headerBtnGreen: { backgroundColor: COLORS.success, borderColor: COLORS.success },
  headerBtnTextGreen: { color: '#fff' },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.panel, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnAccent: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  iconBtnGlyph: { color: COLORS.text, fontSize: 18, fontWeight: '600' },
  iconBtnGlyphAccent: { color: '#fff' },

  recorderPanel: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, alignItems: 'center' },
  statusBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.panel, borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
    alignSelf: 'stretch', marginBottom: 24,
  },
  statusDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: COLORS.textMuted, marginRight: 10,
  },
  statusBarText: {
    flex: 1, color: COLORS.textDim, fontSize: 12,
    fontWeight: '700', letterSpacing: 1.4,
  },
  statusBarTime: {
    color: COLORS.text, fontSize: 14, fontWeight: '700',
    fontVariant: ['tabular-nums'], letterSpacing: 0.5,
  },

  ctrlIcon: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  ctrlIconDisabled: { opacity: 0.3 },
  ctrlIconCircle: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.panel,
    borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 6,
  },
  ctrlIconCircleDanger: { borderColor: COLORS.danger },
  ctrlIconGlyph: { color: COLORS.text, fontSize: 18, fontWeight: '600' },
  ctrlIconLabel: { color: COLORS.textDim, fontSize: 11, fontWeight: '500' },

  sendBtnDisabled: { opacity: 0.5 },

  actionRowMain: {
    flexDirection: 'row', gap: 12, alignSelf: 'stretch',
    alignItems: 'stretch', marginTop: 8,
  },
  recordPill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 18, borderRadius: 14, gap: 10,
    backgroundColor: COLORS.accent,
    shadowColor: COLORS.accent, shadowOpacity: 0.35, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  recordPillRecording: {
    backgroundColor: COLORS.danger, shadowColor: COLORS.danger,
  },
  recordPillGlyph: { color: '#fff', fontSize: 18, fontWeight: '700' },
  recordPillLabel: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },

  transcribePill: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 18, borderRadius: 14,
    backgroundColor: COLORS.success,
    shadowColor: COLORS.success, shadowOpacity: 0.3, shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 }, elevation: 5,
  },
  transcribePillDisabled: { opacity: 0.4, shadowOpacity: 0 },
  transcribePillLabel: { color: '#fff', fontSize: 16, fontWeight: '700', letterSpacing: 0.5 },

  modeCard: {
    flexDirection: 'row', alignItems: 'center',
    margin: 16, padding: 18, borderRadius: 14,
    backgroundColor: COLORS.panel, borderWidth: 1, borderColor: COLORS.border,
  },
  modeCardKicker: { color: COLORS.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 6 },
  modeCardTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700', marginBottom: 4 },
  modeCardDesc: { color: COLORS.textDim, fontSize: 13, lineHeight: 18 },
  modeCardChevron: { color: COLORS.textMuted, fontSize: 28, marginLeft: 12 },

  recipientRow: { paddingHorizontal: 16, marginBottom: 8 },
  label: { color: COLORS.textDim, fontSize: 12, fontWeight: '600', marginBottom: 6, letterSpacing: 0.3 },
  recipientInput: {
    backgroundColor: COLORS.panel, color: COLORS.text,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: COLORS.border, fontSize: 15,
  },

  recordSection: { alignItems: 'center', paddingVertical: 28 },
  statusText: { color: COLORS.textDim, fontSize: 13, marginBottom: 18, letterSpacing: 0.3 },
  recordButton: {
    width: 168, height: 168, borderRadius: 84,
    backgroundColor: COLORS.accent,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: COLORS.accent, shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  recordButtonRecording: { backgroundColor: COLORS.danger, shadowColor: COLORS.danger },
  recordButtonPaused: { backgroundColor: COLORS.warn, shadowColor: COLORS.warn },
  recordButtonPressed: { transform: [{ scale: 0.97 }], opacity: 0.9 },
  recordButtonInner: { alignItems: 'center', justifyContent: 'center' },
  recordIcon: { color: '#fff', fontSize: 40, marginBottom: 4 },
  recordLabel: { color: '#fff', fontSize: 14, fontWeight: '700', letterSpacing: 2 },

  controlsRow: { flexDirection: 'row', gap: 6, marginTop: 18, paddingHorizontal: 16, alignSelf: 'stretch' },
  ctrlBtn: {
    flex: 1, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 8,
    backgroundColor: COLORS.panel, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center', minHeight: 40,
  },
  ctrlBtnDanger: { borderColor: COLORS.danger },
  ctrlBtnDisabled: { opacity: 0.35 },
  ctrlBtnText: { color: COLORS.text, fontSize: 12, fontWeight: '600' },
  ctrlBtnTextDanger: { color: COLORS.danger },
  ctrlBtnTextDisabled: { color: COLORS.textMuted },
  sendBtn: {
    marginTop: 16, paddingVertical: 14, paddingHorizontal: 36, borderRadius: 12,
    backgroundColor: COLORS.success, minWidth: 220, alignItems: 'center',
    shadowColor: COLORS.success, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  sendBtnText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 2 },

  resultCard: {
    margin: 16, padding: 16, borderRadius: 14,
    backgroundColor: COLORS.panel, borderWidth: 1, borderColor: COLORS.border,
  },
  resultKicker: { color: COLORS.accent, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginBottom: 12 },
  fieldLabel: { color: COLORS.textDim, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 6 },
  fieldBox: {
    backgroundColor: COLORS.panelAlt, borderRadius: 10,
    padding: 14, borderWidth: 1, borderColor: COLORS.border,
  },
  fieldText: { color: COLORS.text, fontSize: 15, lineHeight: 22 },

  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  actionBtn: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8,
    backgroundColor: COLORS.panelAlt, borderWidth: 1, borderColor: COLORS.border,
  },
  actionBtnPrimary: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  actionBtnSubtle: { backgroundColor: 'transparent' },
  actionBtnDanger: { backgroundColor: COLORS.danger, borderColor: COLORS.danger },
  actionBtnText: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
  actionBtnTextPrimary: { color: '#fff' },
  actionBtnTextSubtle: { color: COLORS.textDim },

  modalRoot: { flex: 1, backgroundColor: COLORS.bg },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: Platform.OS === 'android' ? 36 : 50, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  modalTitle: { color: COLORS.text, fontSize: 20, fontWeight: '700' },
  modalClose: { color: COLORS.accent, fontSize: 15, fontWeight: '600' },

  tabBar: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  tab: {
    flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
    backgroundColor: COLORS.panel, borderWidth: 1, borderColor: COLORS.border,
  },
  tabActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  tabText: { color: COLORS.textDim, fontSize: 13, fontWeight: '700', letterSpacing: 0.3 },
  tabTextActive: { color: '#fff' },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  toggleLabel: { color: COLORS.text, fontSize: 14, fontWeight: '600', marginBottom: 4 },

  groupLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 8, paddingLeft: 4 },
  modeRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 14, borderRadius: 10,
    backgroundColor: COLORS.panel, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8,
  },
  modeRowActive: { borderColor: COLORS.accent, backgroundColor: COLORS.panelAlt },
  modeRowIcon: { color: COLORS.textDim, fontSize: 22, width: 36, textAlign: 'center' },
  modeRowLabel: { color: COLORS.text, fontSize: 15, fontWeight: '600', marginBottom: 2 },
  modeRowLabelActive: { color: COLORS.accent },
  modeRowDesc: { color: COLORS.textMuted, fontSize: 12, lineHeight: 17 },
  modeRowCheck: { color: COLORS.accent, fontSize: 18, marginLeft: 8 },

  sectionLabel: { color: COLORS.text, fontSize: 14, fontWeight: '700', marginTop: 18, marginBottom: 4 },
  hint: { color: COLORS.textMuted, fontSize: 12, marginBottom: 8 },
  input: {
    backgroundColor: COLORS.panel, color: COLORS.text,
    paddingHorizontal: 14, paddingVertical: 11, borderRadius: 10,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 12, fontSize: 15,
  },

  histItem: {
    backgroundColor: COLORS.panel, padding: 14, borderRadius: 12,
    marginBottom: 10, borderWidth: 1, borderColor: COLORS.border,
  },
  histMeta: { color: COLORS.textMuted, fontSize: 11, marginBottom: 8 },
  histText: { color: COLORS.text, fontSize: 14, lineHeight: 20 },
});
