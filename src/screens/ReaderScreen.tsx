import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  ScrollView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '../components/Header';
import { LineItem } from '../components/LineItem';
import { RadioDramaBar } from '../components/RadioDramaBar';
import { ThemeColors, themes } from '../theme/theme';
import { NexusDatabase, Novel, Chapter, AppSettings } from '../storage/db';
import { LineResult } from '../core/nexus_translator_core';
import { audioService } from '../services/audioService';

interface ReaderScreenProps {
  novelId: string;
  chapterId: string;
  colors: ThemeColors;
  currentThemeKey: 'dark' | 'light' | 'sepia' | 'oled';
  onBack: () => void;
  onThemeChange: (theme: 'dark' | 'light' | 'sepia' | 'oled') => void;
  onSwitchChapter: (chapterId: string) => void;
}

export const ReaderScreen: React.FC<ReaderScreenProps> = ({
  novelId,
  chapterId,
  colors,
  currentThemeKey,
  onBack,
  onThemeChange,
  onSwitchChapter,
}) => {
  const [novel, setNovel] = useState<Novel | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [lines, setLines] = useState<LineResult[]>([]);
  const [activeLineIndex, setActiveLineIndex] = useState<number>(-1);

  // Settings
  const [fontSize, setFontSize] = useState<number>(18);
  const [lineHeight, setLineHeight] = useState<number>(1.8);
  const [displayMode, setDisplayMode] = useState<'thai_only' | 'bilingual' | 'chinese_only'>('thai_only');

  // Appearance Modal
  const [settingsModalVisible, setSettingsModalVisible] = useState<boolean>(false);

  // Surgical Repair Modal
  const [repairModalVisible, setRepairModalVisible] = useState<boolean>(false);
  const [selectedLine, setSelectedLine] = useState<LineResult | null>(null);
  const [editedThai, setEditedThai] = useState<string>('');

  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    loadChapterData();
    loadReaderSettings();

    return () => {
      audioService.stop();
    };
  }, [novelId, chapterId]);

  const loadReaderSettings = async () => {
    const s = await NexusDatabase.getSettings();
    setFontSize(s.readerFontSize || 18);
    setLineHeight(s.readerLineHeight || 1.8);
    setDisplayMode(s.displayMode || 'thai_only');
  };

  const loadChapterData = async () => {
    const n = await NexusDatabase.getNovel(novelId);
    const chap = await NexusDatabase.getChapter(novelId, chapterId);
    const allChaps = await NexusDatabase.getChapters(novelId);

    setNovel(n);
    setChapter(chap);
    setChapters(allChaps);

    if (chap) {
      if (chap.lines && chap.lines.length > 0) {
        setLines(chap.lines);
      } else if (chap.translatedText) {
        // Fallback: split translated text and source into lines
        const srcLines = chap.sourceRaw.split('\n').filter(l => l.trim().length > 0);
        const transLines = chap.translatedText.split('\n').filter(l => l.trim().length > 0);
        const generatedLines: LineResult[] = srcLines.map((src, idx) => ({
          index: idx + 1,
          kind: 'STORY',
          source: src,
          translated: transLines[idx] || '',
          issues: [],
          repaired: false,
        }));
        setLines(generatedLines);
      } else {
        // Untranslated: show source lines
        const srcLines = chap.sourceRaw.split('\n').filter(l => l.trim().length > 0);
        const generatedLines: LineResult[] = srcLines.map((src, idx) => ({
          index: idx + 1,
          kind: 'STORY',
          source: src,
          translated: '',
          issues: [],
          repaired: false,
        }));
        setLines(generatedLines);
      }
    }
  };

  const handleLinePress = (line: LineResult) => {
    setSelectedLine(line);
    setEditedThai(line.translated || '');
    setRepairModalVisible(true);
  };

  const handleSaveSurgicalRepair = async () => {
    if (!selectedLine || !chapter) return;

    const updatedLines = lines.map((l) => {
      if (l.index === selectedLine.index) {
        return {
          ...l,
          translated: editedThai.trim(),
          issues: [], // Clear issues on manual user fix
        };
      }
      return l;
    });

    setLines(updatedLines);
    chapter.lines = updatedLines;
    chapter.translatedText = updatedLines.map(l => l.translated).filter(Boolean).join('\n\n');
    await NexusDatabase.saveChapter(novelId, chapter);

    setRepairModalVisible(false);
  };

  const handlePlayFromLine = (lineIndex: number) => {
    setRepairModalVisible(false);
    audioService.playLines(lines, lineIndex - 1);
  };

  const handleStartPlay = () => {
    if (lines.length > 0) {
      const startIdx = activeLineIndex >= 0 ? activeLineIndex : 0;
      audioService.playLines(lines, startIdx);
    }
  };

  const handleAudioLineChanged = (lineIdx: number) => {
    setActiveLineIndex(lineIdx);
    // Auto-scroll list to active line
    try {
      if (flatListRef.current && lineIdx >= 0 && lineIdx < lines.length) {
        flatListRef.current.scrollToIndex({
          index: lineIdx,
          animated: true,
          viewPosition: 0.3,
        });
      }
    } catch (e) {
      // scrollToIndex can throw if out of layout range
    }
  };

  const saveSettings = async (newFontSize: number, newMode: 'thai_only' | 'bilingual' | 'chinese_only') => {
    setFontSize(newFontSize);
    setDisplayMode(newMode);
    await NexusDatabase.saveSettings({
      readerFontSize: newFontSize,
      displayMode: newMode,
    });
  };

  // Chapter navigation
  const currentIdx = chapters.findIndex(c => c.id === chapterId);
  const prevChapter = currentIdx > 0 ? chapters[currentIdx - 1] : null;
  const nextChapter = currentIdx < chapters.length - 1 ? chapters[currentIdx + 1] : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.readerBg }]}>
      <Header
        title={chapter?.title || 'กำลังอ่าน'}
        subtitle={novel?.title}
        colors={colors}
        onBack={onBack}
        rightActions={[
          {
            icon: 'volume-high-outline',
            color: colors.primary,
            onPress: handleStartPlay,
          },
          {
            icon: 'options-outline',
            color: colors.text,
            onPress: () => setSettingsModalVisible(true),
          },
        ]}
      />

      <FlatList
        ref={flatListRef}
        data={lines}
        keyExtractor={(item) => `line_${item.index}`}
        contentContainerStyle={styles.readerList}
        renderItem={({ item, index }) => (
          <LineItem
            line={item}
            colors={colors}
            displayMode={displayMode}
            fontSize={fontSize}
            lineHeightMultiplier={lineHeight}
            isActive={index === activeLineIndex}
            onPress={() => handleLinePress(item)}
            onLongPress={() => handlePlayFromLine(item.index)}
          />
        )}
        ListFooterComponent={
          <View style={styles.footerNav}>
            <View style={styles.navButtonsRow}>
              {prevChapter ? (
                <TouchableOpacity
                  style={[styles.chapNavBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => onSwitchChapter(prevChapter.id)}
                >
                  <Ionicons name="arrow-back" size={16} color={colors.text} />
                  <Text style={[styles.chapNavText, { color: colors.text }]}>ตอนก่อนหน้า</Text>
                </TouchableOpacity>
              ) : (
                <View style={{ flex: 1 }} />
              )}

              {nextChapter ? (
                <TouchableOpacity
                  style={[styles.chapNavBtn, { backgroundColor: colors.primary }]}
                  onPress={() => onSwitchChapter(nextChapter.id)}
                >
                  <Text style={[styles.chapNavText, { color: '#ffffff' }]}>ตอนถัดไป</Text>
                  <Ionicons name="arrow-forward" size={16} color="#ffffff" />
                </TouchableOpacity>
              ) : (
                <View style={{ flex: 1 }} />
              )}
            </View>
          </View>
        }
      />

      {/* Floating Radio Drama & TTS Bar */}
      <RadioDramaBar colors={colors} onLineChange={handleAudioLineChanged} />

      {/* SURGICAL REPAIR & LINE INSPECTOR MODAL */}
      <Modal visible={repairModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  แก้ไขเฉพาะจุด (Surgical Repair)
                </Text>
                <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]}>
                  บรรทัดที่ {selectedLine?.index}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setRepairModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>ภาษาจีนต้นฉบับ</Text>
              <View style={[styles.sourceBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Text style={[styles.sourceBoxText, { color: colors.text }]}>{selectedLine?.source}</Text>
              </View>

              {/* Detected issues if any */}
              {selectedLine?.issues && selectedLine.issues.length > 0 && (
                <View style={[styles.issuesBox, { backgroundColor: colors.warning + '18', borderColor: colors.warning }]}>
                  <Text style={[styles.issuesTitle, { color: colors.warning }]}>⚠️ ตรวจพบจุดสังเกต:</Text>
                  {selectedLine.issues.map((iss, i) => (
                    <Text key={i} style={[styles.issueItem, { color: colors.text }]}>
                      • {iss.code}: {iss.detail}
                    </Text>
                  ))}
                </View>
              )}

              <Text style={[styles.label, { color: colors.textSecondary }]}>คำแปลภาษาไทย (แก้ไขได้ทันที)</Text>
              <TextInput
                style={[
                  styles.repairInput,
                  { backgroundColor: colors.background, color: colors.text, borderColor: colors.border },
                ]}
                multiline
                numberOfLines={4}
                value={editedThai}
                onChangeText={setEditedThai}
              />

              <View style={styles.repairActions}>
                <TouchableOpacity
                  style={[styles.playLineBtn, { backgroundColor: colors.primaryLight }]}
                  onPress={() => selectedLine && handlePlayFromLine(selectedLine.index)}
                >
                  <Ionicons name="play" size={16} color={colors.primary} />
                  <Text style={[styles.playLineText, { color: colors.primary }]}>เล่นเสียงจากตรงนี้</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.saveRepairBtn, { backgroundColor: colors.primary }]}
                  onPress={handleSaveSurgicalRepair}
                >
                  <Ionicons name="checkmark" size={16} color="#ffffff" />
                  <Text style={styles.saveRepairText}>บันทึกคำแปล</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* READING APPEARANCE MODAL */}
      <Modal visible={settingsModalVisible} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.settingsCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>ปรับแต่งการอ่าน</Text>
              <TouchableOpacity onPress={() => setSettingsModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.settingsBody}>
              {/* Theme Picker */}
              <Text style={[styles.label, { color: colors.textSecondary }]}>ธีมหน้าจอ</Text>
              <View style={styles.themeRow}>
                {(['dark', 'oled', 'sepia', 'light'] as const).map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[
                      styles.themeBtn,
                      {
                        backgroundColor: themes[t].readerBg,
                        borderColor: currentThemeKey === t ? colors.primary : themes[t].cardBorder,
                        borderWidth: currentThemeKey === t ? 2 : 1,
                      },
                    ]}
                    onPress={() => onThemeChange(t)}
                  >
                    <Text style={{ color: themes[t].readerText, fontSize: 13, fontWeight: '700' }}>
                      {t.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Display Mode */}
              <Text style={[styles.label, { color: colors.textSecondary, marginTop: 14 }]}>รูปแบบการแสดงผล</Text>
              <View style={styles.modeRow}>
                <TouchableOpacity
                  style={[
                    styles.modeBtn,
                    {
                      backgroundColor: displayMode === 'thai_only' ? colors.primary : colors.background,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => saveSettings(fontSize, 'thai_only')}
                >
                  <Text style={{ color: displayMode === 'thai_only' ? '#fff' : colors.text, fontSize: 12 }}>
                    ไทยล้วน
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modeBtn,
                    {
                      backgroundColor: displayMode === 'bilingual' ? colors.primary : colors.background,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => saveSettings(fontSize, 'bilingual')}
                >
                  <Text style={{ color: displayMode === 'bilingual' ? '#fff' : colors.text, fontSize: 12 }}>
                    จีนคู่ไทย
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modeBtn,
                    {
                      backgroundColor: displayMode === 'chinese_only' ? colors.primary : colors.background,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => saveSettings(fontSize, 'chinese_only')}
                >
                  <Text style={{ color: displayMode === 'chinese_only' ? '#fff' : colors.text, fontSize: 12 }}>
                    จีนล้วน
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Font Size */}
              <Text style={[styles.label, { color: colors.textSecondary, marginTop: 14 }]}>
                ขนาดตัวอักษร: {fontSize}px
              </Text>
              <View style={styles.fontSizeRow}>
                <TouchableOpacity
                  style={[styles.fontBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => saveSettings(Math.max(14, fontSize - 2), displayMode)}
                >
                  <Text style={[styles.fontBtnText, { color: colors.text }]}>A-</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.fontBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => saveSettings(Math.min(32, fontSize + 2), displayMode)}
                >
                  <Text style={[styles.fontBtnText, { color: colors.text }]}>A+</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  readerList: {
    paddingVertical: 14,
    paddingHorizontal: 8,
    paddingBottom: 80,
  },
  footerNav: {
    paddingVertical: 30,
    paddingHorizontal: 16,
  },
  navButtonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  chapNavBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
  },
  chapNavText: {
    fontSize: 14,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    maxHeight: '80%',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  settingsCard: {
    borderRadius: 16,
    borderWidth: 1,
    paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#444',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  modalSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  modalBody: {
    padding: 16,
  },
  settingsBody: {
    padding: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  sourceBox: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
  },
  sourceBoxText: {
    fontSize: 15,
    lineHeight: 22,
  },
  issuesBox: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
  },
  issuesTitle: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  issueItem: {
    fontSize: 12,
    marginTop: 2,
  },
  repairInput: {
    minHeight: 80,
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  repairActions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  playLineBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    gap: 6,
  },
  playLineText: {
    fontSize: 13,
    fontWeight: '600',
  },
  saveRepairBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    gap: 6,
  },
  saveRepairText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  themeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  themeBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  modeBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  fontSizeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  fontBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  fontBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
});
