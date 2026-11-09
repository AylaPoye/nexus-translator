import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  Alert,
  ScrollView,
  Share,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Header } from '../components/Header';
import { ThemeColors } from '../theme/theme';
import {
  NexusDatabase,
  Novel,
  Chapter,
  GlossaryItem,
  RelationshipItem,
} from '../storage/db';
import {
  Genre,
  GlossaryCategory,
  Gender,
  RelationshipType,
} from '../core/nexus_translator_core';
import { translatorService } from '../services/translatorService';

interface NovelDetailScreenProps {
  novelId: string;
  colors: ThemeColors;
  onBack: () => void;
  onOpenReader: (novelId: string, chapterId: string) => void;
  onOpenSettings: () => void;
}

type TabType = 'chapters' | 'glossary' | 'relationships' | 'export';

const CATEGORY_NAMES: Record<GlossaryCategory, string> = {
  CHARACTER: 'ตัวละคร',
  PLACE: 'สถานที่',
  TECHNIQUE: 'วิชายุทธ์',
  CULTIVATION: 'ระดับพลัง',
};

const REL_TYPE_NAMES: Record<RelationshipType, string> = {
  FAMILY: 'ครอบครัว/สายเลือด',
  MASTER: 'อาจารย์-ศิษย์/สำนัก',
  LOVER: 'คนรัก/คู่ชีวิต',
  ENEMY: 'ศัตรู/คู่อาฆาต',
};

export const NovelDetailScreen: React.FC<NovelDetailScreenProps> = ({
  novelId,
  colors,
  onBack,
  onOpenReader,
  onOpenSettings,
}) => {
  const [novel, setNovel] = useState<Novel | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [glossary, setGlossary] = useState<GlossaryItem[]>([]);
  const [relationships, setRelationships] = useState<RelationshipItem[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('chapters');

  // Translation state
  const [translatingChapterId, setTranslatingChapterId] = useState<string | null>(null);
  const [progressInfo, setProgressInfo] = useState<{
    pct: number;
    phase: string;
    provider: string;
  } | null>(null);

  // Term Modal
  const [termModalVisible, setTermModalVisible] = useState(false);
  const [editTermId, setEditTermId] = useState<string | null>(null);
  const [termSource, setTermSource] = useState('');
  const [termTarget, setTermTarget] = useState('');
  const [termCategory, setTermCategory] = useState<GlossaryCategory>('CHARACTER');
  const [termGender, setTermGender] = useState<Gender>('UNKNOWN');
  const [termNotes, setTermNotes] = useState('');

  // Relationship Modal
  const [relModalVisible, setRelModalVisible] = useState(false);
  const [fromTermId, setFromTermId] = useState('');
  const [toTermId, setToTermId] = useState('');
  const [relType, setRelType] = useState<RelationshipType>('FAMILY');
  const [callingPronoun, setCallingPronoun] = useState('');
  const [selfPronoun, setSelfPronoun] = useState('');

  // Add Chapter Modal
  const [addChapterModalVisible, setAddChapterModalVisible] = useState(false);
  const [newChapTitle, setNewChapTitle] = useState('');
  const [newChapContent, setNewChapContent] = useState('');

  useEffect(() => {
    loadData();

    const unsub = translatorService.addProgressListener((info) => {
      if (info.chapterId === translatingChapterId) {
        setProgressInfo({
          pct: info.percentage,
          phase: info.phase,
          provider: 'Gemini',
        });
      }
      loadChapters();
    });

    return () => {
      unsub();
    };
  }, [novelId, translatingChapterId]);

  const loadData = async () => {
    const n = await NexusDatabase.getNovel(novelId);
    setNovel(n);
    await loadChapters();
    await loadGlossary();
    await loadRelationships();
  };

  const loadChapters = async () => {
    const list = await NexusDatabase.getChapters(novelId);
    setChapters(list);
  };

  const loadGlossary = async () => {
    const list = await NexusDatabase.getGlossary(novelId);
    setGlossary(list);
  };

  const loadRelationships = async () => {
    const list = await NexusDatabase.getRelationships(novelId);
    setRelationships(list);
  };

  const handleStartTranslate = async (chapterId: string) => {
    try {
      setTranslatingChapterId(chapterId);
      setProgressInfo({ pct: 5, phase: 'เริ่มต้นแปล', provider: 'Gemini' });
      await translatorService.translateChapter(novelId, chapterId);
      Alert.alert('สำเร็จ', 'แปลบทนี้เสร็จสมบูรณ์แล้ว!');
      await loadChapters();
    } catch (err: any) {
      Alert.alert('เกิดข้อผิดพลาดในการแปล', err.message || 'โปรดตรวจสอบ API Key');
    } finally {
      setTranslatingChapterId(null);
      setProgressInfo(null);
    }
  };

  const handleTranslateAll = async () => {
    const pending = chapters.filter((c) => c.status !== 'COMPLETED');
    if (pending.length === 0) {
      Alert.alert('แจ้งเตือน', 'ทุกตอนแปลเสร็จสิ้นแล้ว');
      return;
    }

    for (const chap of pending) {
      try {
        setTranslatingChapterId(chap.id);
        await translatorService.translateChapter(novelId, chap.id);
      } catch (err: any) {
        Alert.alert('หยุดการแปล', `เกิดข้อผิดพลาดที่ตอน "${chap.title}": ${err.message}`);
        break;
      }
    }
    setTranslatingChapterId(null);
    setProgressInfo(null);
    await loadChapters();
  };

  // Glossary save
  const handleSaveTerm = async () => {
    if (!termSource.trim() || !termTarget.trim()) {
      Alert.alert('ข้อมูลไม่ครบ', 'กรุณาระบุคำศัพท์ภาษาจีนและคำแปลภาษาไทย');
      return;
    }

    const item: GlossaryItem = {
      id: editTermId || 'term_' + Date.now(),
      novelId,
      source: termSource.trim(),
      target: termTarget.trim(),
      category: termCategory,
      gender: termCategory === 'CHARACTER' ? termGender : undefined,
      notes: termNotes.trim() || undefined,
      confidence: 1.0,
      locked: true,
    };

    await NexusDatabase.saveGlossaryItem(item);
    setTermModalVisible(false);
    resetTermForm();
    await loadGlossary();
  };

  const resetTermForm = () => {
    setEditTermId(null);
    setTermSource('');
    setTermTarget('');
    setTermCategory('CHARACTER');
    setTermGender('UNKNOWN');
    setTermNotes('');
  };

  const handleSaveRelationship = async () => {
    if (!fromTermId || !toTermId) {
      Alert.alert('ข้อมูลไม่ครบ', 'กรุณาเลือกตัวละครทั้งสองฝ่าย');
      return;
    }

    const fromChar = glossary.find((g) => g.id === fromTermId);
    const toChar = glossary.find((g) => g.id === toTermId);

    const rel: RelationshipItem = {
      id: 'rel_' + Date.now(),
      novelId,
      fromTermId,
      toTermId,
      fromName: fromChar ? fromChar.target : 'ตัวละคร A',
      toName: toChar ? toChar.target : 'ตัวละคร B',
      relationshipType: relType,
      callingPronoun: callingPronoun.trim() || 'เจ้า',
      selfPronoun: selfPronoun.trim() || 'ข้า',
    };

    await NexusDatabase.saveRelationship(rel);
    setRelModalVisible(false);
    setCallingPronoun('');
    setSelfPronoun('');
    await loadRelationships();
  };

  const handleAddChapter = async () => {
    if (!newChapTitle.trim() || !newChapContent.trim()) {
      Alert.alert('ข้อมูลไม่ครบ', 'กรุณาระบุชื่อตอนและเนื้อหาภาษาจีน');
      return;
    }

    const nextIdx = chapters.length + 1;
    const chap: Chapter = {
      id: `chap_${novelId}_${Date.now()}`,
      novelId,
      chapterIndex: nextIdx,
      title: newChapTitle.trim(),
      sourceRaw: newChapContent.trim(),
      status: 'PENDING',
      progress: 0,
    };

    await NexusDatabase.saveChapter(novelId, chap);
    setAddChapterModalVisible(false);
    setNewChapTitle('');
    setNewChapContent('');
    await loadChapters();
  };

  const handleExportText = async () => {
    const translatedChapters = chapters.filter((c) => c.status === 'COMPLETED');
    if (translatedChapters.length === 0) {
      Alert.alert('แจ้งเตือน', 'ยังไม่มีตอนที่แปลเสร็จ');
      return;
    }

    let fullText = `${novel?.title || ''}\nผู้แต่ง: ${novel?.author || ''}\n\n`;
    for (const c of translatedChapters) {
      fullText += `===============================\n${c.title}\n===============================\n\n${c.translatedText || ''}\n\n\n`;
    }

    await Clipboard.setStringAsync(fullText);
    Alert.alert('คัดลอกแล้ว', `คัดลอกบทแปลทั้งหมด (${translatedChapters.length} ตอน) ไปยังคลิปบอร์ดแล้ว!`);
  };

  if (!novel) return null;

  const characters = glossary.filter((g) => g.category === 'CHARACTER');

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Header
        title={novel.title}
        subtitle={`${novel.author} • ${novel.chapterCount} ตอน`}
        colors={colors}
        onBack={onBack}
        rightActions={[
          {
            icon: 'settings-outline',
            color: colors.text,
            onPress: onOpenSettings,
          },
        ]}
      />

      {/* Tabs Bar */}
      <View style={[styles.tabBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'chapters' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab('chapters')}
        >
          <Ionicons name="list" size={18} color={activeTab === 'chapters' ? colors.primary : colors.textSecondary} />
          <Text style={[styles.tabText, { color: activeTab === 'chapters' ? colors.primary : colors.textSecondary }]}>
            บทนิยาย ({chapters.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'glossary' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab('glossary')}
        >
          <Ionicons name="hardware-chip" size={18} color={activeTab === 'glossary' ? colors.primary : colors.textSecondary} />
          <Text style={[styles.tabText, { color: activeTab === 'glossary' ? colors.primary : colors.textSecondary }]}>
            สมองกล ({glossary.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'relationships' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab('relationships')}
        >
          <Ionicons name="git-network" size={18} color={activeTab === 'relationships' ? colors.primary : colors.textSecondary} />
          <Text style={[styles.tabText, { color: activeTab === 'relationships' ? colors.primary : colors.textSecondary }]}>
            ความสัมพันธ์ ({relationships.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'export' && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab('export')}
        >
          <Ionicons name="share-outline" size={18} color={activeTab === 'export' ? colors.primary : colors.textSecondary} />
          <Text style={[styles.tabText, { color: activeTab === 'export' ? colors.primary : colors.textSecondary }]}>
            ส่งออก
          </Text>
        </TouchableOpacity>
      </View>

      {/* TAB 1: CHAPTERS */}
      {activeTab === 'chapters' && (
        <View style={styles.tabContent}>
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.primary }]}
              onPress={handleTranslateAll}
              disabled={translatingChapterId !== null}
            >
              <Ionicons name="flash" size={16} color="#ffffff" />
              <Text style={styles.actionBtnText}>แปลทุกตอนที่รออยู่</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}
              onPress={() => setAddChapterModalVisible(true)}
            >
              <Ionicons name="add" size={16} color={colors.text} />
              <Text style={[styles.actionBtnText, { color: colors.text }]}>เพิ่มตอนใหม่</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={chapters}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.chapterList}
            renderItem={({ item }) => {
              const isTranslating = translatingChapterId === item.id;
              return (
                <View style={[styles.chapterCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <View style={styles.chapterHeader}>
                    <Text style={[styles.chapterTitle, { color: colors.text }]} numberOfLines={1}>
                      {item.title}
                    </Text>

                    <View style={styles.statusBadgeWrap}>
                      {item.status === 'COMPLETED' && (
                        <View style={[styles.statusBadge, { backgroundColor: colors.success + '22' }]}>
                          <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                          <Text style={[styles.statusText, { color: colors.success }]}>แปลแล้ว</Text>
                        </View>
                      )}

                      {item.status === 'TRANSLATING' && (
                        <View style={[styles.statusBadge, { backgroundColor: colors.primaryLight }]}>
                          <Ionicons name="sync" size={14} color={colors.primary} />
                          <Text style={[styles.statusText, { color: colors.primary }]}>
                            {progressInfo ? `${progressInfo.pct}%` : `${item.progress}%`}
                          </Text>
                        </View>
                      )}

                      {item.status === 'PENDING' && (
                        <View style={[styles.statusBadge, { backgroundColor: colors.border }]}>
                          <Text style={[styles.statusText, { color: colors.textMuted }]}>รอแปล</Text>
                        </View>
                      )}

                      {item.status === 'ERROR' && (
                        <View style={[styles.statusBadge, { backgroundColor: colors.danger + '22' }]}>
                          <Ionicons name="alert-circle" size={14} color={colors.danger} />
                          <Text style={[styles.statusText, { color: colors.danger }]}>ผิดพลาด</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Progress bar if translating */}
                  {isTranslating && (
                    <View style={styles.progressContainer}>
                      <View
                        style={[
                          styles.progressBar,
                          {
                            width: `${progressInfo ? progressInfo.pct : item.progress}%`,
                            backgroundColor: colors.primary,
                          },
                        ]}
                      />
                    </View>
                  )}

                  {/* Actions for Chapter */}
                  <View style={styles.chapterButtons}>
                    {item.status === 'COMPLETED' ? (
                      <TouchableOpacity
                        style={[styles.readBtn, { backgroundColor: colors.primary }]}
                        onPress={() => onOpenReader(novelId, item.id)}
                      >
                        <Ionicons name="book" size={16} color="#ffffff" />
                        <Text style={styles.readBtnText}>เปิดอ่าน</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={[styles.readBtn, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}
                        onPress={() => onOpenReader(novelId, item.id)}
                      >
                        <Ionicons name="eye-outline" size={16} color={colors.text} />
                        <Text style={[styles.readBtnText, { color: colors.text }]}>ดูต้นฉบับ</Text>
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity
                      style={[
                        styles.translateBtn,
                        {
                          backgroundColor: isTranslating ? colors.border : colors.primaryLight,
                        },
                      ]}
                      onPress={() => handleStartTranslate(item.id)}
                      disabled={isTranslating}
                    >
                      <Ionicons
                        name={item.status === 'COMPLETED' ? 'refresh' : 'language'}
                        size={16}
                        color={colors.primary}
                      />
                      <Text style={[styles.translateBtnText, { color: colors.primary }]}>
                        {item.status === 'COMPLETED' ? 'แปลใหม่' : 'เริ่มแปล'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }}
          />
        </View>
      )}

      {/* TAB 2: NEXUS BRAIN (GLOSSARY) */}
      {activeTab === 'glossary' && (
        <View style={styles.tabContent}>
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.primary }]}
              onPress={() => {
                resetTermForm();
                setTermModalVisible(true);
              }}
            >
              <Ionicons name="add" size={16} color="#ffffff" />
              <Text style={styles.actionBtnText}>เพิ่มคำศัพท์ / ชื่อตัวละคร</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={glossary}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.glossaryList}
            renderItem={({ item }) => (
              <View style={[styles.glossaryCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <View style={styles.glossaryTop}>
                  <View>
                    <Text style={[styles.glossarySource, { color: colors.primary }]}>{item.source}</Text>
                    <Text style={[styles.glossaryTarget, { color: colors.text }]}>{item.target}</Text>
                    {item.pinyin && <Text style={[styles.pinyinText, { color: colors.textSecondary }]}>{item.pinyin}</Text>}
                  </View>

                  <View style={styles.categoryBadgeWrap}>
                    <View style={[styles.categoryBadge, { backgroundColor: colors.border }]}>
                      <Text style={[styles.categoryText, { color: colors.textSecondary }]}>
                        {CATEGORY_NAMES[item.category]}
                      </Text>
                    </View>
                    {item.gender && item.gender !== 'UNKNOWN' && (
                      <View
                        style={[
                          styles.genderBadge,
                          {
                            backgroundColor: item.gender === 'MALE' ? '#1f6feb22' : '#f43f5e22',
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.genderText,
                            { color: item.gender === 'MALE' ? '#58a6ff' : '#f43f5e' },
                          ]}
                        >
                          {item.gender === 'MALE' ? 'ชาย' : 'หญิง'}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                {item.notes && (
                  <Text style={[styles.glossaryNotes, { color: colors.textSecondary }]}>
                    {item.notes}
                  </Text>
                )}

                <View style={styles.termActions}>
                  <TouchableOpacity
                    onPress={async () => {
                      await NexusDatabase.deleteGlossaryItem(novelId, item.id);
                      await loadGlossary();
                    }}
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.danger} />
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        </View>
      )}

      {/* TAB 3: RELATIONSHIPS */}
      {activeTab === 'relationships' && (
        <View style={styles.tabContent}>
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.primary }]}
              onPress={() => setRelModalVisible(true)}
            >
              <Ionicons name="git-network" size={16} color="#ffffff" />
              <Text style={styles.actionBtnText}>กำหนดความสัมพันธ์และสรรพนาม</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={relationships}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.glossaryList}
            renderItem={({ item }) => (
              <View style={[styles.glossaryCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                <View style={styles.relHeader}>
                  <Text style={[styles.relName, { color: colors.text }]}>{item.fromName}</Text>
                  <Ionicons name="arrow-forward" size={16} color={colors.primary} />
                  <Text style={[styles.relName, { color: colors.text }]}>{item.toName}</Text>
                </View>

                <View style={[styles.relTypeBadge, { backgroundColor: colors.primaryLight }]}>
                  <Text style={[styles.relTypeText, { color: colors.primary }]}>
                    {REL_TYPE_NAMES[item.relationshipType]}
                  </Text>
                </View>

                <View style={styles.pronounBox}>
                  <Text style={[styles.pronounLabel, { color: colors.textSecondary }]}>
                    เรียกอีกฝ่าย: <Text style={{ color: colors.text, fontWeight: '700' }}>"{item.callingPronoun}"</Text>
                  </Text>
                  <Text style={[styles.pronounLabel, { color: colors.textSecondary }]}>
                    แทนตัวเอง: <Text style={{ color: colors.text, fontWeight: '700' }}>"{item.selfPronoun}"</Text>
                  </Text>
                </View>

                <View style={styles.termActions}>
                  <TouchableOpacity
                    onPress={async () => {
                      await NexusDatabase.deleteRelationship(novelId, item.id);
                      await loadRelationships();
                    }}
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.danger} />
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        </View>
      )}

      {/* TAB 4: EXPORT */}
      {activeTab === 'export' && (
        <View style={[styles.tabContent, { padding: 20 }]}>
          <Text style={[styles.exportTitle, { color: colors.text }]}>ส่งออกเนื้อหานิยายที่แปลแล้ว</Text>
          <Text style={[styles.exportDesc, { color: colors.textSecondary }]}>
            รวบรวมตอนที่แปลสำเร็จทั้งหมด เพื่อคัดลอกหรือส่งต่อไปยังแอพพลิเคชันอื่น
          </Text>

          <TouchableOpacity
            style={[styles.exportBtn, { backgroundColor: colors.primary }]}
            onPress={handleExportText}
          >
            <Ionicons name="copy-outline" size={20} color="#ffffff" />
            <Text style={styles.exportBtnText}>คัดลอกบทแปลทั้งหมดลงคลิปบอร์ด</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ADD TERM MODAL */}
      <Modal visible={termModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>เพิ่มศัพท์ในสมองกล (NEXUS Brain)</Text>
              <TouchableOpacity onPress={() => setTermModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>ภาษาจีนต้นฉบับ *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                placeholder="เช่น 萧云"
                placeholderTextColor={colors.textMuted}
                value={termSource}
                onChangeText={setTermSource}
              />

              <Text style={[styles.label, { color: colors.textSecondary }]}>คำแปลภาษาไทย *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                placeholder="เช่น เซียวอวิ๋น"
                placeholderTextColor={colors.textMuted}
                value={termTarget}
                onChangeText={setTermTarget}
              />

              <Text style={[styles.label, { color: colors.textSecondary }]}>หมวดหมู่</Text>
              <View style={styles.chipRow}>
                {(['CHARACTER', 'PLACE', 'TECHNIQUE', 'CULTIVATION'] as GlossaryCategory[]).map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: termCategory === cat ? colors.primary : colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                    onPress={() => setTermCategory(cat)}
                  >
                    <Text style={{ color: termCategory === cat ? '#ffffff' : colors.text, fontSize: 12 }}>
                      {CATEGORY_NAMES[cat]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {termCategory === 'CHARACTER' && (
                <>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>เพศ</Text>
                  <View style={styles.chipRow}>
                    {(['MALE', 'FEMALE', 'UNKNOWN'] as Gender[]).map((g) => (
                      <TouchableOpacity
                        key={g}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: termGender === g ? colors.primary : colors.background,
                            borderColor: colors.border,
                          },
                        ]}
                        onPress={() => setTermGender(g)}
                      >
                        <Text style={{ color: termGender === g ? '#ffffff' : colors.text, fontSize: 12 }}>
                          {g === 'MALE' ? 'ชาย' : g === 'FEMALE' ? 'หญิง' : 'ไม่ระบุ'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              <Text style={[styles.label, { color: colors.textSecondary }]}>หมายเหตุ / บทบาท</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                placeholder="เช่น ตัวเอก, ศิษย์พี่สำนักหยกขาว"
                placeholderTextColor={colors.textMuted}
                value={termNotes}
                onChangeText={setTermNotes}
              />

              <TouchableOpacity
                style={[styles.submitBtn, { backgroundColor: colors.primary }]}
                onPress={handleSaveTerm}
              >
                <Text style={styles.submitBtnText}>บันทึกลงสมองกล</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* RELATIONSHIP MODAL */}
      <Modal visible={relModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>ผูกความสัมพันธ์และสรรพนาม</Text>
              <TouchableOpacity onPress={() => setRelModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>ตัวละครที่ 1 (ฝ่ายพูด)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                {characters.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: fromTermId === c.id ? colors.primary : colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                    onPress={() => setFromTermId(c.id)}
                  >
                    <Text style={{ color: fromTermId === c.id ? '#ffffff' : colors.text }}>{c.target}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={[styles.label, { color: colors.textSecondary }]}>ตัวละครที่ 2 (ฝ่ายฟัง)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                {characters.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: toTermId === c.id ? colors.primary : colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                    onPress={() => setToTermId(c.id)}
                  >
                    <Text style={{ color: toTermId === c.id ? '#ffffff' : colors.text }}>{c.target}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={[styles.label, { color: colors.textSecondary }]}>ประเภทความสัมพันธ์</Text>
              <View style={styles.chipRow}>
                {(['FAMILY', 'MASTER', 'LOVER', 'ENEMY'] as RelationshipType[]).map((rt) => (
                  <TouchableOpacity
                    key={rt}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: relType === rt ? colors.primary : colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                    onPress={() => setRelType(rt)}
                  >
                    <Text style={{ color: relType === rt ? '#ffffff' : colors.text, fontSize: 12 }}>
                      {REL_TYPE_NAMES[rt]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[styles.label, { color: colors.textSecondary }]}>
                สรรพนามที่ตัวละคร 1 ใช้เรียกตัวละคร 2
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                placeholder="เช่น ศิษย์น้อง, เจ้า, ท่านพี่"
                placeholderTextColor={colors.textMuted}
                value={callingPronoun}
                onChangeText={setCallingPronoun}
              />

              <Text style={[styles.label, { color: colors.textSecondary }]}>
                สรรพนามแทนตัวเองของตัวละคร 1
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                placeholder="เช่น ข้า, ศิษย์พี่"
                placeholderTextColor={colors.textMuted}
                value={selfPronoun}
                onChangeText={setSelfPronoun}
              />

              <TouchableOpacity
                style={[styles.submitBtn, { backgroundColor: colors.primary }]}
                onPress={handleSaveRelationship}
              >
                <Text style={styles.submitBtnText}>บันทึกความสัมพันธ์</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ADD CHAPTER MODAL */}
      <Modal visible={addChapterModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>เพิ่มตอนใหม่</Text>
              <TouchableOpacity onPress={() => setAddChapterModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>ชื่อตอน</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                placeholder="เช่น ตอนที่ 3: หวนคืนตระกูล"
                placeholderTextColor={colors.textMuted}
                value={newChapTitle}
                onChangeText={setNewChapTitle}
              />

              <Text style={[styles.label, { color: colors.textSecondary }]}>เนื้อหาภาษาจีน</Text>
              <TextInput
                style={[
                  styles.textArea,
                  { backgroundColor: colors.background, color: colors.text, borderColor: colors.border },
                ]}
                placeholder="วางเนื้อหาภาษาจีนที่นี่..."
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={8}
                value={newChapContent}
                onChangeText={setNewChapContent}
              />

              <TouchableOpacity
                style={[styles.submitBtn, { backgroundColor: colors.primary }]}
                onPress={handleAddChapter}
              >
                <Text style={styles.submitBtnText}>บันทึกตอน</Text>
              </TouchableOpacity>
            </ScrollView>
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
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 4,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '600',
  },
  tabContent: {
    flex: 1,
  },
  actionRow: {
    flexDirection: 'row',
    padding: 12,
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  actionBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  chapterList: {
    padding: 12,
    paddingBottom: 40,
  },
  chapterCard: {
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 10,
  },
  chapterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  chapterTitle: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  statusBadgeWrap: {
    flexDirection: 'row',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  progressContainer: {
    height: 4,
    backgroundColor: '#333',
    borderRadius: 2,
    overflow: 'hidden',
    marginVertical: 8,
  },
  progressBar: {
    height: '100%',
  },
  chapterButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
    gap: 8,
  },
  readBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  readBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  translateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  translateBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  glossaryList: {
    padding: 12,
    paddingBottom: 40,
  },
  glossaryCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 10,
  },
  glossaryTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  glossarySource: {
    fontSize: 16,
    fontWeight: '700',
  },
  glossaryTarget: {
    fontSize: 15,
    fontWeight: '600',
    marginTop: 2,
  },
  pinyinText: {
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 2,
  },
  categoryBadgeWrap: {
    flexDirection: 'row',
    gap: 6,
  },
  categoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '500',
  },
  genderBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  genderText: {
    fontSize: 11,
    fontWeight: '600',
  },
  glossaryNotes: {
    fontSize: 12,
    marginTop: 6,
  },
  termActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 6,
  },
  relHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  relName: {
    fontSize: 15,
    fontWeight: '700',
  },
  relTypeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginBottom: 8,
  },
  relTypeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  pronounBox: {
    gap: 2,
    marginBottom: 6,
  },
  pronounLabel: {
    fontSize: 12,
  },
  exportTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  exportDesc: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    gap: 8,
  },
  exportBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    maxHeight: '85%',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
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
    fontSize: 17,
    fontWeight: '700',
  },
  modalBody: {
    padding: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 6,
  },
  input: {
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  textArea: {
    minHeight: 120,
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    fontSize: 13,
    textAlignVertical: 'top',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chipScroll: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    marginRight: 6,
  },
  submitBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 20,
    marginBottom: 24,
  },
  submitBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});
