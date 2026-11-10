import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '../components/Header';
import { ThemeColors } from '../theme/theme';
import { NexusDatabase, AppSettings, defaultSettings } from '../storage/db';
import {
  createGeminiEndpoint,
  createGroqEndpoint,
  SceneId,
} from '../core/nexus_translator_core';
import { audioService } from '../services/audioService';

interface SettingsScreenProps {
  colors: ThemeColors;
  onBack: () => void;
}

const SCENES: Array<{ id: SceneId; label: string; icon: string }> = [
  { id: 'RAIN', label: 'สายฝน', icon: 'rainy-outline' },
  { id: 'STORM', label: 'พายุคลั่ง', icon: 'thunderstorm-outline' },
  { id: 'FOREST', label: 'ป่าทึบ', icon: 'leaf-outline' },
  { id: 'CAVE', label: 'ถ้ำลึกลับ', icon: 'earth-outline' },
  { id: 'BATTLE', label: 'ศึกประจัญ', icon: 'flash-outline' },
  { id: 'FIRE', label: 'เพลิงผลาญ', icon: 'flame-outline' },
  { id: 'NIGHT', label: 'ราตรีกาล', icon: 'moon-outline' },
  { id: 'CROWD', label: 'ตลาดพลุกพล่าน', icon: 'people-outline' },
  { id: 'BREAKTHROUGH', label: 'ทะลวงด่าน', icon: 'sparkles-outline' },
  { id: 'TENSION', label: 'ตึงเครียด', icon: 'alert-circle-outline' },
  { id: 'SADNESS', label: 'โศกศัลย์', icon: 'water-outline' },
];

const AVAILABLE_GEMINI_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', badge: 'แนะนำ (เสถียร/เร็วที่สุด)' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', badge: 'คุณภาพสูง (ฉลาดล้ำ)' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', badge: 'แม่นยำ (สำรอง)' },
];

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ colors, onBack }) => {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [geminiKey1, setGeminiKey1] = useState('');
  const [geminiKey2, setGeminiKey2] = useState('');
  const [geminiKey3, setGeminiKey3] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-flash');
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [activeTestScene, setActiveTestScene] = useState<SceneId | null>(null);

  const settingsRef = useRef({ geminiKey1, geminiKey2, geminiKey3, groqKey, geminiModel });
  useEffect(() => {
    settingsRef.current = { geminiKey1, geminiKey2, geminiKey3, groqKey, geminiModel };
  }, [geminiKey1, geminiKey2, geminiKey3, groqKey, geminiModel]);

  useEffect(() => {
    loadSettings();
    return () => {
      audioService.stopScene();
      // Auto-save on unmount
      const { geminiKey1: k1, geminiKey2: k2, geminiKey3: k3, groqKey: gk, geminiModel: gm } = settingsRef.current;
      NexusDatabase.saveSettings({
        geminiKeys: [k1, k2, k3].map(k => k.trim().replace(/^["']|["']$/g, '')),
        groqKey: gk.trim().replace(/^["']|["']$/g, ''),
        geminiModel: gm,
      }).catch((e) => console.warn('Unmount auto-save failed:', e));
    };
  }, []);

  const loadSettings = async () => {
    const s = await NexusDatabase.getSettings();
    setSettings(s);
    setGeminiKey1(s.geminiKeys[0] || '');
    setGeminiKey2(s.geminiKeys[1] || '');
    setGeminiKey3(s.geminiKeys[2] || '');
    setGroqKey(s.groqKey || '');
    setGeminiModel(s.geminiModel || 'gemini-2.5-flash');
  };

  const persistCurrentValues = async () => {
    try {
      await NexusDatabase.saveSettings({
        geminiKeys: [geminiKey1, geminiKey2, geminiKey3].map(k => k.trim().replace(/^["']|["']$/g, '')),
        groqKey: groqKey.trim().replace(/^["']|["']$/g, ''),
        geminiModel: geminiModel,
      });
    } catch (e) {
      console.warn('Auto-save settings failed:', e);
    }
  };

  const handleSelectModel = async (modelId: string) => {
    setGeminiModel(modelId);
    try {
      await NexusDatabase.saveSettings({
        geminiKeys: [geminiKey1, geminiKey2, geminiKey3].map(k => k.trim().replace(/^["']|["']$/g, '')),
        groqKey: groqKey.trim().replace(/^["']|["']$/g, ''),
        geminiModel: modelId,
      });
    } catch (e) {
      console.warn('Auto-save model failed:', e);
    }
  };

  const handleBack = async () => {
    // Auto-save any entered keys on back navigation to protect user input
    await persistCurrentValues();
    onBack();
  };

  const handleSaveKeys = async () => {
    const cleanKeys = [geminiKey1, geminiKey2, geminiKey3].map(k => k.trim().replace(/^["']|["']$/g, ''));
    const cleanGroq = groqKey.trim().replace(/^["']|["']$/g, '');
    const updated = await NexusDatabase.saveSettings({
      geminiKeys: cleanKeys,
      groqKey: cleanGroq,
      geminiModel: geminiModel,
    });
    setSettings(updated);
    Alert.alert('สำเร็จ ✅', 'บันทึกการตั้งค่า API Keys เรียบร้อยแล้ว');
  };

  const testKey = async (slotName: string, keyVal: string, isGroq = false) => {
    const cleanVal = keyVal.trim().replace(/^["']|["']$/g, '');
    if (!cleanVal) {
      Alert.alert('แจ้งเตือน', `กรุณาระบุคีย์ ${slotName} ก่อนกดทดสอบ`);
      return;
    }

    setTestingKey(slotName);
    try {
      const endpoint = isGroq
        ? createGroqEndpoint(cleanVal, { model: settings.groqModel })
        : createGeminiEndpoint(cleanVal, { model: geminiModel });

      const resp = await endpoint.call({
        system: 'You are a test assistant.',
        user: 'Reply with the word OK.',
      });

      if (resp.text && resp.text.length > 0) {
        // Auto-save the valid key
        const currentKeys = [geminiKey1, geminiKey2, geminiKey3].map(k => k.trim().replace(/^["']|["']$/g, ''));
        if (slotName === 'Gemini Key 1') currentKeys[0] = cleanVal;
        else if (slotName === 'Gemini Key 2') currentKeys[1] = cleanVal;
        else if (slotName === 'Gemini Key 3') currentKeys[2] = cleanVal;

        await NexusDatabase.saveSettings({
          geminiKeys: currentKeys,
          groqKey: isGroq ? cleanVal : groqKey.trim(),
          geminiModel,
        });

        Alert.alert('เชื่อมต่อสำเร็จ! ✅', `${slotName} ใช้งานได้ปกติ พร้อมบันทึกคีย์เรียบร้อยแล้ว`);
      } else {
        Alert.alert('เตือน', 'ไม่ได้รับข้อความตอบกลับจาก API');
      }
    } catch (err: any) {
      Alert.alert('เชื่อมต่อล้มเหลว ❌', `เกิดข้อผิดพลาด: ${err.message || 'ไม่สามารถติดต่อ API ได้'}`);
    } finally {
      setTestingKey(null);
    }
  };

  const playSceneAudio = async (sceneId: SceneId) => {
    setActiveTestScene(sceneId);
    await audioService.testScene(sceneId);
  };

  const stopSceneAudio = async () => {
    setActiveTestScene(null);
    await audioService.stopScene();
  };

  const handleResetData = () => {
    Alert.alert(
      'ยืนยันการรีเซ็ตข้อมูล',
      'คุณต้องการรีเซ็ตข้อมูลตัวอย่างทั้งหมดหรือไม่? นิยายที่สร้างขึ้นเองจะไม่ถูกลบ',
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'รีเซ็ต',
          style: 'destructive',
          onPress: async () => {
            await NexusDatabase.initializeSampleDataIfEmpty();
            Alert.alert('สำเร็จ', 'โหลดข้อมูลตัวอย่างเรียบร้อยแล้ว');
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Header title="การตั้งค่า (Settings)" colors={colors} onBack={handleBack} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* SECTION 1: API KEYS */}
        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.sectionTitleRow}>
            <Ionicons name="key-outline" size={20} color={colors.primary} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Google Gemini API Keys (ฟรี)
            </Text>
          </View>
          <Text style={[styles.sectionDesc, { color: colors.textSecondary }]}>
            รองรับระบบ Failover อัตโนมัติ: หากโควต้าของ Key 1 เต็ม ระบบจะสลับไป Key 2 และ Key 3 ทันทีโดยไม่สะดุด
          </Text>

          {/* Gemini Model Selector */}
          <Text style={[styles.keyLabel, { color: colors.textSecondary }]}>โมเดล Gemini ที่ใช้งาน</Text>
          <View style={styles.modelChipsRow}>
            {AVAILABLE_GEMINI_MODELS.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.modelChip,
                  {
                    backgroundColor: geminiModel === item.id ? colors.primary : colors.background,
                    borderColor: geminiModel === item.id ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => handleSelectModel(item.id)}
              >
                <Text
                  style={{
                    color: geminiModel === item.id ? '#ffffff' : colors.text,
                    fontSize: 12,
                    fontWeight: '700',
                  }}
                >
                  {item.label}
                </Text>
                <Text
                  style={{
                    color: geminiModel === item.id ? '#e0e7ff' : colors.textMuted,
                    fontSize: 10,
                    marginTop: 2,
                  }}
                >
                  {item.badge}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Gemini Key 1 */}
          <Text style={[styles.keyLabel, { color: colors.textSecondary }]}>Gemini Key 1 (Primary)</Text>
          <View style={styles.inputWithAction}>
            <TextInput
              style={[
                styles.keyInput,
                { backgroundColor: colors.background, color: colors.text, borderColor: colors.border },
              ]}
              placeholder="AIzaSy..."
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              value={geminiKey1}
              onChangeText={setGeminiKey1}
              onBlur={persistCurrentValues}
            />
            <TouchableOpacity
              style={[styles.testBtn, { backgroundColor: colors.primaryLight }]}
              onPress={() => testKey('Gemini Key 1', geminiKey1)}
              disabled={testingKey === 'Gemini Key 1'}
            >
              {testingKey === 'Gemini Key 1' ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={[styles.testBtnText, { color: colors.primary }]}>ทดสอบ</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Gemini Key 2 */}
          <Text style={[styles.keyLabel, { color: colors.textSecondary }]}>Gemini Key 2 (Backup 1)</Text>
          <View style={styles.inputWithAction}>
            <TextInput
              style={[
                styles.keyInput,
                { backgroundColor: colors.background, color: colors.text, borderColor: colors.border },
              ]}
              placeholder="AIzaSy... (สำรอง)"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              value={geminiKey2}
              onChangeText={setGeminiKey2}
              onBlur={persistCurrentValues}
            />
            <TouchableOpacity
              style={[styles.testBtn, { backgroundColor: colors.primaryLight }]}
              onPress={() => testKey('Gemini Key 2', geminiKey2)}
              disabled={testingKey === 'Gemini Key 2'}
            >
              {testingKey === 'Gemini Key 2' ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={[styles.testBtnText, { color: colors.primary }]}>ทดสอบ</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Gemini Key 3 */}
          <Text style={[styles.keyLabel, { color: colors.textSecondary }]}>Gemini Key 3 (Backup 2)</Text>
          <View style={styles.inputWithAction}>
            <TextInput
              style={[
                styles.keyInput,
                { backgroundColor: colors.background, color: colors.text, borderColor: colors.border },
              ]}
              placeholder="AIzaSy... (สำรอง)"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              value={geminiKey3}
              onChangeText={setGeminiKey3}
              onBlur={persistCurrentValues}
            />
            <TouchableOpacity
              style={[styles.testBtn, { backgroundColor: colors.primaryLight }]}
              onPress={() => testKey('Gemini Key 3', geminiKey3)}
              disabled={testingKey === 'Gemini Key 3'}
            >
              {testingKey === 'Gemini Key 3' ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={[styles.testBtnText, { color: colors.primary }]}>ทดสอบ</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Groq Key */}
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.sectionTitleRow}>
            <Ionicons name="flash-outline" size={20} color={colors.secondary} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Groq Cloud API Key (ทางเลือกสำรอง)</Text>
          </View>
          <Text style={[styles.sectionDesc, { color: colors.textSecondary }]}>
            เชื่อมต่อ Qwen 3.8 27B หรือ Qwen3 32B ความเร็วระดับ 300+ tokens/s
          </Text>
          <View style={styles.inputWithAction}>
            <TextInput
              style={[
                styles.keyInput,
                { backgroundColor: colors.background, color: colors.text, borderColor: colors.border },
              ]}
              placeholder="gsk_..."
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              value={groqKey}
              onChangeText={setGroqKey}
              onBlur={persistCurrentValues}
            />
            <TouchableOpacity
              style={[styles.testBtn, { backgroundColor: colors.secondary + '22' }]}
              onPress={() => testKey('Groq Key', groqKey, true)}
              disabled={testingKey === 'Groq Key'}
            >
              {testingKey === 'Groq Key' ? (
                <ActivityIndicator size="small" color={colors.secondary} />
              ) : (
                <Text style={[styles.testBtnText, { color: colors.secondary }]}>ทดสอบ</Text>
              )}
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.saveKeysBtn, { backgroundColor: colors.primary }]}
            onPress={handleSaveKeys}
          >
            <Ionicons name="save-outline" size={18} color="#ffffff" />
            <Text style={styles.saveKeysBtnText}>บันทึก API Keys ทั้งหมด</Text>
          </TouchableOpacity>
        </View>

        {/* SECTION 2: PROCEDURAL RADIO DRAMA TEST BENCH */}
        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.sectionTitleRow}>
            <Ionicons name="musical-notes-outline" size={20} color={colors.accent} />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              ห้องทดลองเสียงละครวิทยุ (Radio Drama Synthesizer)
            </Text>
          </View>
          <Text style={[styles.sectionDesc, { color: colors.textSecondary }]}>
            สังเคราะห์เสียงบรรยากาศตามสถานการณ์แบบ Procedural Web Audio API โดยไม่ต้องโหลดไฟล์เสียง
          </Text>

          <View style={styles.sceneGrid}>
            {SCENES.map((scene) => {
              const isActive = activeTestScene === scene.id;
              return (
                <TouchableOpacity
                  key={scene.id}
                  style={[
                    styles.sceneCard,
                    {
                      backgroundColor: isActive ? colors.primary : colors.background,
                      borderColor: isActive ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => playSceneAudio(scene.id)}
                >
                  <Ionicons
                    name={scene.icon as any}
                    size={22}
                    color={isActive ? '#ffffff' : colors.primary}
                  />
                  <Text
                    style={[
                      styles.sceneLabel,
                      { color: isActive ? '#ffffff' : colors.text },
                    ]}
                  >
                    {scene.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {activeTestScene && (
            <TouchableOpacity
              style={[styles.stopAudioBtn, { backgroundColor: colors.danger }]}
              onPress={stopSceneAudio}
            >
              <Ionicons name="stop" size={18} color="#ffffff" />
              <Text style={styles.stopAudioBtnText}>หยุดเสียงบรรยากาศ</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* SECTION 3: SYSTEM INFO & RESET */}
        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 8 }]}>เกี่ยวกับแอปพลิเคชัน</Text>
          <Text style={[styles.infoLine, { color: colors.textSecondary }]}>NEXUS Translator v1.0.0 (Expo React Native)</Text>
          <Text style={[styles.infoLine, { color: colors.textSecondary }]}>สถาปัตยกรรม: Core 81.8KB + LINE_NNNN Protocol</Text>
          <Text style={[styles.infoLine, { color: colors.textSecondary }]}>แพลตฟอร์ม: {Platform.OS.toUpperCase()}</Text>

          <TouchableOpacity
            style={[styles.resetBtn, { backgroundColor: colors.border }]}
            onPress={handleResetData}
          >
            <Ionicons name="refresh-outline" size={16} color={colors.text} />
            <Text style={[styles.resetBtnText, { color: colors.text }]}>โหลดข้อมูลนิยายตัวอย่างใหม่</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  sectionDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  keyLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 4,
  },
  modelChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
    marginTop: 2,
  },
  modelChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  inputWithAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  keyInput: {
    flex: 1,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  testBtn: {
    paddingHorizontal: 14,
    height: 42,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  testBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    marginVertical: 14,
  },
  saveKeysBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    borderRadius: 10,
    marginTop: 12,
    gap: 8,
  },
  saveKeysBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  sceneGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 8,
  },
  sceneCard: {
    width: '30.5%',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  sceneLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  stopAudioBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 40,
    borderRadius: 8,
    marginTop: 14,
    gap: 6,
  },
  stopAudioBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  infoLine: {
    fontSize: 13,
    marginBottom: 4,
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 40,
    borderRadius: 8,
    marginTop: 14,
    gap: 6,
  },
  resetBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
