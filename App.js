import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, ScrollView, TextInput,
  Modal, Alert, Share, ActivityIndicator, Linking, Platform, Pressable,
} from 'react-native';
import { Audio } from 'expo-av';
import * as Clipboard from 'expo-clipboard';
import { MODES, GROUPS, parseEmailOutput } from './src/modes';
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

  const pttRecRef = useRef(null);
  const [pttActive, setPttActive] = useState(false);
  const [pttCopied, setPttCopied] = useState(false);

  useEffect(() => { (async () => {
    setApiKeyState(await getApiKey());
    setSettingsState(await getSettings());
    setHistory(await getHistory());
    await Audio.requestPermissionsAsync();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
  })(); }, []);

  useEffect(() => {
    if (pttActive) {
      tickRef.current = setInterval(() => setRecordSeconds(s => s + 1), 1000);
    } else if (tickRef.current) {
      clearInterval(tickRef.current); tickRef.current = null;
    }
    return () => tickRef.current && clearInterval(tickRef.current);
  }, [pttActive]);

  if (!settings) return <View style={styles.loadingRoot}><ActivityIndicator color={COLORS.accent} /></View>;

  const activeMode = settings.activeMode || 'basic';
  const activeModeDef = MODES[activeMode] || MODES.basic;
  const isEmailMode = activeModeDef.output === 'email';

  async function selectMode(key) {
    const next = { ...settings, activeMode: key };
    setSettingsState(next); await setSettings(next);
    setShowModes(false);
  }

  async function pttPressIn() {
    if (!apiKey) { Alert.alert('No API key', 'Add your OpenRouter key in Settings.'); return; }
    if (loading) return;
    try {
      setResult(''); setEmailParts({ subject: '', body: '' });
      setPttCopied(false); setRecordSeconds(0);
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      pttRecRef.current = rec;
      setPttActive(true);
    } catch (e) { Alert.alert('Record error', String(e.message || e)); }
  }

  async function pttPressOut() {
    const rec = pttRecRef.current;
    pttRecRef.current = null;
    setPttActive(false);
    if (!rec) return;
    let uri = null;
    try { await rec.stopAndUnloadAsync(); uri = rec.getURI(); } catch (e) {
      Alert.alert('Stop error', String(e.message || e)); return;
    }
    if (!uri) return;
    const payload = {
      audioUris: [uri],
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

      if (MODES[activeMode]?.output === 'email') {
        const parts = parseEmailOutput(text);
        setEmailParts(parts);
        // Auto-copy body for email mode
        await Clipboard.setStringAsync(parts.body || text);
      } else {
        await Clipboard.setStringAsync(text);
      }
      setPttCopied(true);

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
      if (MODES[lastPayload.mode]?.output === 'email') {
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

  const resultModeDef = resultMode ? MODES[resultMode] : null;
  const resultIsEmail = resultModeDef?.output === 'email';

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>Voxcast</Text>
          <Text style={styles.tagline}>Speak. Reshape. Send.</Text>
        </View>
        <View style={styles.headerBtns}>
          <HeaderBtn label="History" onPress={() => setShowHistory(true)} />
          <HeaderBtn label="Settings" onPress={() => setShowSettings(true)} />
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">

        <TouchableOpacity style={styles.modeCard} onPress={() => setShowModes(true)} activeOpacity={0.7}>
          <View style={{ flex: 1 }}>
            <Text style={styles.modeCardKicker}>PRESET</Text>
            <Text style={styles.modeCardTitle}>{activeModeDef.icon}  {activeModeDef.label}</Text>
            <Text style={styles.modeCardDesc} numberOfLines={2}>{activeModeDef.description}</Text>
          </View>
          <Text style={styles.modeCardChevron}>›</Text>
        </TouchableOpacity>

        <View style={styles.recipientRow}>
          <Text style={styles.label}>To (optional)</Text>
          <TextInput
            style={styles.recipientInput}
            placeholder={isEmailMode ? 'Recipient name' : 'e.g. Sarah'}
            placeholderTextColor={COLORS.textMuted}
            value={recipient}
            onChangeText={setRecipient}
          />
        </View>

        <View style={styles.recordSection}>
          <Text style={styles.statusText}>
            {loading
              ? 'Processing…'
              : pttActive
                ? `Recording  ${formatTime(recordSeconds)}`
                : pttCopied
                  ? 'Copied — hold again to record'
                  : 'Hold to record'}
          </Text>

          <Pressable
            onPressIn={pttPressIn}
            onPressOut={pttPressOut}
            disabled={loading}
            style={({ pressed }) => [
              styles.recordButton,
              pressed && styles.recordButtonPressed,
              loading && { opacity: 0.5 },
            ]}>
            <View style={styles.recordButtonInner}>
              <Text style={styles.recordIcon}>●</Text>
              <Text style={styles.recordLabel}>HOLD</Text>
            </View>
          </Pressable>

          {loading && <ActivityIndicator color={COLORS.accent} size="large" style={{ marginTop: 16 }} />}
        </View>

        {result ? (
          resultIsEmail ? (
            <View style={styles.resultCard}>
              <Text style={styles.resultKicker}>{resultModeDef.icon} {resultModeDef.label}</Text>

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
              <Text style={styles.resultKicker}>{resultModeDef.icon} {resultModeDef.label}</Text>
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

function HeaderBtn({ label, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.headerBtn}>
      <Text style={styles.headerBtnText}>{label}</Text>
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
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Choose a preset</Text>
          <TouchableOpacity onPress={onClose}><Text style={styles.modalClose}>Done</Text></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
          {GROUPS.map(group => (
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
                    <Text style={[styles.modeRowIcon, active && { color: COLORS.accent }]}>{m.icon}</Text>
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
        </ScrollView>
      </View>
    </Modal>
  );
}

function SettingsModal({ visible, onClose, apiKey, onSaveKey, onClearKey, settings, onSaveSettings }) {
  const [keyInput, setKeyInput] = useState('');
  const [name, setName] = useState(settings.userName || '');
  useEffect(() => { setName(settings.userName || ''); setKeyInput(''); }, [settings, visible]);

  async function save() {
    const next = { ...settings, userName: name.trim() };
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
            const m = MODES[h.mode];
            return (
              <View key={h.id} style={styles.histItem}>
                <Text style={styles.histMeta}>
                  {m?.icon || '·'} {m?.label || h.mode}
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
  headerBtns: { flexDirection: 'row', gap: 8 },
  headerBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: COLORS.panel, borderWidth: 1, borderColor: COLORS.border },
  headerBtnText: { color: COLORS.text, fontSize: 13, fontWeight: '600' },

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
  recordButtonPressed: { backgroundColor: COLORS.accentDim, transform: [{ scale: 0.97 }] },
  recordButtonInner: { alignItems: 'center', justifyContent: 'center' },
  recordIcon: { color: '#fff', fontSize: 40, marginBottom: 4 },
  recordLabel: { color: '#fff', fontSize: 14, fontWeight: '700', letterSpacing: 2 },

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
