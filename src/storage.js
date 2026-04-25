import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_OPENROUTER = 'openrouter_api_key';
const KEY_SETTINGS = 'voxcast_settings_v1';
const KEY_HISTORY = 'voxcast_history_v1';
const MAX_HISTORY = 10;

export async function getApiKey() {
  try { return await SecureStore.getItemAsync(KEY_OPENROUTER); } catch { return null; }
}
export async function setApiKey(v) {
  if (!v) return SecureStore.deleteItemAsync(KEY_OPENROUTER);
  return SecureStore.setItemAsync(KEY_OPENROUTER, v);
}
export async function clearApiKey() { return SecureStore.deleteItemAsync(KEY_OPENROUTER); }

const DEFAULT_SETTINGS = {
  userName: '',
  activeMode: 'basic',
};

export async function getSettings() {
  try {
    const raw = await AsyncStorage.getItem(KEY_SETTINGS);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch { return DEFAULT_SETTINGS; }
}
export async function setSettings(s) {
  return AsyncStorage.setItem(KEY_SETTINGS, JSON.stringify(s));
}

export async function getHistory() {
  try {
    const raw = await AsyncStorage.getItem(KEY_HISTORY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
export async function pushHistory(entry) {
  const list = await getHistory();
  const next = [entry, ...list].slice(0, MAX_HISTORY);
  await AsyncStorage.setItem(KEY_HISTORY, JSON.stringify(next));
  return next;
}
export async function clearHistory() {
  await AsyncStorage.removeItem(KEY_HISTORY);
}
