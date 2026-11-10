import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Modal,
  Alert,
  ScrollView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { Header } from '../components/Header';
import { ThemeColors } from '../theme/theme';
import { NexusDatabase, Novel, Chapter } from '../storage/db';
import { Genre, splitParagraphs } from '../core/nexus_translator_core';
import { splitNovelIntoChapters } from '../core/chapterSplitter';

interface LibraryScreenProps {
  colors: ThemeColors;
  onOpenNovel: (novelId: string) => void;
  onOpenSettings: () => void;
}

const GENRE_LABELS: Record<Genre, string> = {
  WUXIA: 'กำลังภายใน (Wuxia)',
  XIANXIA: 'เทพเซียน (Xianxia)',
  PERIOD: 'ย้อนยุค/วังหลวง (Period)',
  MODERN: 'ยุคปัจจุบัน (Modern)',
};

export const LibraryScreen: React.FC<LibraryScreenProps> = ({
  colors,
  onOpenNovel,
  onOpenSettings,
}) => {
  const [novels, setNovels] = useState<Novel[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [modalVisible, setModalVisible] = useState(false);

  // New novel form state
  const [newTitle, setNewTitle] = useState('');
  const [newAuthor, setNewAuthor] = useState('');
  const [newGenre, setNewGenre] = useState<Genre>('XIANXIA');
  const [newDescription, setNewDescription] = useState('');
  const [newContent, setNewContent] = useState('');
  const [splitChapters, setSplitChapters] = useState(true);
  const fullContentRef = useRef<string | null>(null);

  useEffect(() => {
    loadNovels();
  }, []);

  const loadNovels = async () => {
    await NexusDatabase.initializeSampleDataIfEmpty();
    const list = await NexusDatabase.getNovels();
    setNovels(list);
  };

  const handlePickDocument = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/plain', 'text/*', '*/*'],
        copyToCacheDirectory: true,
      });

      if (!res.canceled && res.assets && res.assets[0]) {
        const file = res.assets[0];
        const rawName = file.name || 'นิยายนำเข้า';
        setNewTitle(rawName.replace(/\.[^/.]+$/, ''));

        let content = '';
        if (Platform.OS === 'web') {
          // On Web, support File object, Blob, and fetch(file.uri)
          const rawFile = (file as any).file;
          let arrayBuffer: ArrayBuffer | null = null;

          if (rawFile && typeof rawFile.arrayBuffer === 'function') {
            arrayBuffer = await rawFile.arrayBuffer();
          } else if (file.uri) {
            const resp = await fetch(file.uri);
            arrayBuffer = await resp.arrayBuffer();
          }

          if (arrayBuffer) {
            const bytes = new Uint8Array(arrayBuffer);
            if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
              // UTF-16LE with BOM
              try {
                content = new TextDecoder('utf-16le').decode(arrayBuffer);
              } catch {
                content = '';
              }
            } else if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
              // UTF-16BE with BOM
              try {
                content = new TextDecoder('utf-16be').decode(arrayBuffer);
              } catch {
                content = '';
              }
            }

            if (!content) {
              try {
                // Try standard UTF-8 first
                content = new TextDecoder('utf-8', { fatal: true }).decode(arrayBuffer);
              } catch {
                // Fallback to GB18030 (standard for Chinese web novel .txt files)
                try {
                  content = new TextDecoder('gb18030').decode(arrayBuffer);
                } catch {
                  content = new TextDecoder().decode(arrayBuffer);
                }
              }
            }
          }
        } else {
          // Native mobile (iOS / Android)
          const FileSystem = await import('expo-file-system');
          content = await FileSystem.readAsStringAsync(file.uri, {
            encoding: FileSystem.EncodingType.UTF8,
          });
        }

        if (content && content.trim().length > 0) {
          fullContentRef.current = content;
          if (content.length > 25000) {
            setNewContent(content.slice(0, 20000) + `\n\n... [ไฟล์ขนาดใหญ่: โหลดเนื้อหาครบ ${content.length.toLocaleString()} ตัวอักษร]`);
          } else {
            setNewContent(content);
          }
          const previewChapters = splitChapters
            ? splitNovelIntoChapters(content, rawName).length
            : 1;
          Alert.alert(
            'นำเข้าไฟล์สำเร็จ ✅',
            `อ่านไฟล์ "${rawName}" เรียบร้อยแล้ว\n• ความยาว: ${(content.length / 1000).toFixed(1)}k ตัวอักษร\n• ตรวจพบ: ${previewChapters} ตอน`
          );
        } else {
          Alert.alert('แจ้งเตือน', 'ไฟล์ที่เลือกไม่มีข้อความหรือว่างเปล่า');
        }
      }
    } catch (err: any) {
      console.error('Error picking document:', err);
      Alert.alert('ข้อผิดพลาด', `ไม่สามารถอ่านไฟล์ได้: ${err?.message || 'โปรดลองใหม่อีกครั้ง'}`);
    }
  };

  const handleCreateNovel = async () => {
    if (!newTitle.trim()) {
      Alert.alert('ข้อมูลไม่ครบ', 'กรุณาระบุชื่อเรื่องนิยาย');
      return;
    }

    const novelId = 'novel_' + Date.now();
    const chapters: Chapter[] = [];

    const effectiveContent = (fullContentRef.current && newContent.includes('[ไฟล์ขนาดใหญ่: โหลดเนื้อหาครบ'))
      ? fullContentRef.current
      : newContent;

    if (effectiveContent.trim().length > 0) {
      if (splitChapters) {
        const split = splitNovelIntoChapters(effectiveContent, newTitle.trim());
        split.forEach((sc, idx) => {
          chapters.push({
            id: `chap_${novelId}_${idx + 1}`,
            novelId,
            chapterIndex: idx + 1,
            title: sc.title,
            sourceRaw: sc.content,
            status: 'PENDING',
            progress: 0,
          });
        });
      } else {
        chapters.push({
          id: `chap_${novelId}_1`,
          novelId,
          chapterIndex: 1,
          title: `ตอนที่ 1: ${newTitle.trim()}`,
          sourceRaw: effectiveContent.trim(),
          status: 'PENDING',
          progress: 0,
        });
      }
    }

    const novel: Novel = {
      id: novelId,
      title: newTitle.trim(),
      author: newAuthor.trim() || 'ไม่ระบุผู้แต่ง',
      genre: newGenre,
      description: newDescription.trim() || 'นิยายที่นำเข้าส่วนตัว',
      chapterCount: chapters.length,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await NexusDatabase.saveNovel(novel);
    if (chapters.length > 0) {
      await NexusDatabase.saveChapters(novelId, chapters);
    }

    setModalVisible(false);
    resetForm();
    await loadNovels();
    onOpenNovel(novelId);
  };

  const resetForm = () => {
    setNewTitle('');
    setNewAuthor('');
    setNewDescription('');
    setNewContent('');
    fullContentRef.current = null;
    setNewGenre('XIANXIA');
  };

  const handleDeleteNovel = (novel: Novel) => {
    Alert.alert(
      'ยืนยันการลบ',
      `คุณต้องการลบนิยายเรื่อง "${novel.title}" หรือไม่? ข้อมูลบทแปลและคลังคำศัพท์จะถูกลบทั้งหมด`,
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'ลบ',
          style: 'destructive',
          onPress: async () => {
            await NexusDatabase.deleteNovel(novel.id);
            await loadNovels();
          },
        },
      ]
    );
  };

  const filteredNovels = novels.filter(
    (n) =>
      n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.author.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Header
        title="NEXUS Translator"
        subtitle="ระบบแปลนิยายจีนและพากย์เสียงละครวิทยุ AI"
        colors={colors}
        rightActions={[
          {
            icon: 'add-circle',
            color: colors.primary,
            onPress: () => setModalVisible(true),
          },
          {
            icon: 'settings-outline',
            color: colors.text,
            onPress: onOpenSettings,
          },
        ]}
      />

      {/* Search Bar */}
      <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Ionicons name="search" size={18} color={colors.textSecondary} style={styles.searchIcon} />
        <TextInput
          placeholder="ค้นหานิยาย หรือผู้แต่ง..."
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          style={[styles.searchInput, { color: colors.text }]}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Novel List */}
      <FlatList
        data={filteredNovels}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.novelCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
            activeOpacity={0.8}
            onPress={() => onOpenNovel(item.id)}
            onLongPress={() => handleDeleteNovel(item)}
          >
            <View style={[styles.novelCover, { backgroundColor: colors.primaryLight }]}>
              <Ionicons name="book" size={32} color={colors.primary} />
            </View>

            <View style={styles.novelInfo}>
              <View style={styles.titleRow}>
                <Text style={[styles.novelTitle, { color: colors.text }]} numberOfLines={1}>
                  {item.title}
                </Text>
              </View>

              <Text style={[styles.novelAuthor, { color: colors.textSecondary }]} numberOfLines={1}>
                {item.author}
              </Text>

              <View style={styles.badgeRow}>
                <View style={[styles.genreBadge, { backgroundColor: colors.border }]}>
                  <Text style={[styles.genreText, { color: colors.textSecondary }]}>
                    {GENRE_LABELS[item.genre]}
                  </Text>
                </View>

                <View style={[styles.countBadge, { backgroundColor: colors.primaryLight }]}>
                  <Text style={[styles.countText, { color: colors.primary }]}>
                    {item.chapterCount} ตอน
                  </Text>
                </View>
              </View>
            </View>

            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="library-outline" size={64} color={colors.textMuted} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>ยังไม่มีนิยายในคลัง</Text>
            <TouchableOpacity
              style={[styles.importBtn, { backgroundColor: colors.primary }]}
              onPress={() => setModalVisible(true)}
            >
              <Ionicons name="add" size={18} color="#ffffff" />
              <Text style={styles.importBtnText}>นำเข้านิยายเรื่องแรก</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {/* Import / Create Novel Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>นำเข้า / เพิ่มนิยายใหม่</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>ชื่อเรื่องนิยาย *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                placeholder="เช่น สยบฟ้าล่าสวรรค์"
                placeholderTextColor={colors.textMuted}
                value={newTitle}
                onChangeText={setNewTitle}
              />

              <Text style={[styles.label, { color: colors.textSecondary }]}>ผู้แต่ง</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
                placeholder="เช่น เฟิงหลิงเทียนเซี่ย"
                placeholderTextColor={colors.textMuted}
                value={newAuthor}
                onChangeText={setNewAuthor}
              />

              <Text style={[styles.label, { color: colors.textSecondary }]}>ประเภทนิยาย (Genre สำหรับเลือกตรรกะและสรรพนาม)</Text>
              <View style={styles.genrePicker}>
                {(['XIANXIA', 'WUXIA', 'PERIOD', 'MODERN'] as Genre[]).map((g) => (
                  <TouchableOpacity
                    key={g}
                    style={[
                      styles.genreOption,
                      {
                        backgroundColor: newGenre === g ? colors.primary : colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                    onPress={() => setNewGenre(g)}
                  >
                    <Text style={{ color: newGenre === g ? '#ffffff' : colors.text, fontSize: 12, fontWeight: '600' }}>
                      {GENRE_LABELS[g].split(' ')[0]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.fileRow}>
                <TouchableOpacity
                  style={[styles.pickDocBtn, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
                  onPress={handlePickDocument}
                >
                  <Ionicons name="document-text-outline" size={20} color={colors.primary} />
                  <Text style={[styles.pickDocText, { color: colors.primary }]}>เลือกไฟล์ข้อความ (.txt)</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.splitCheck, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => setSplitChapters(!splitChapters)}
                >
                  <Ionicons
                    name={splitChapters ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={splitChapters ? colors.primary : colors.textMuted}
                  />
                  <Text style={[styles.splitText, { color: colors.text }]}>แยกตอนอัตโนมัติ (第X章)</Text>
                </TouchableOpacity>
              </View>

              <Text style={[styles.label, { color: colors.textSecondary }]}>เนื้อหาต้นฉบับภาษาจีน (หรือวางข้อความที่นี่)</Text>
              <TextInput
                style={[
                  styles.textArea,
                  { backgroundColor: colors.background, color: colors.text, borderColor: colors.border },
                ]}
                placeholder="วางข้อความภาษาจีนของนิยายหลายๆ ตอนได้ที่นี่..."
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={8}
                value={newContent}
                onChangeText={setNewContent}
              />

              <TouchableOpacity
                style={[styles.submitBtn, { backgroundColor: colors.primary }]}
                onPress={handleCreateNovel}
              >
                <Ionicons name="checkmark-circle" size={20} color="#ffffff" />
                <Text style={styles.submitBtnText}>บันทึกและเริ่มจัดการบทแปล</Text>
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
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 12,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  novelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  novelCover: {
    width: 52,
    height: 68,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  novelInfo: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  novelTitle: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  novelAuthor: {
    fontSize: 13,
    marginTop: 3,
  },
  badgeRow: {
    flexDirection: 'row',
    marginTop: 8,
  },
  genreBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginRight: 8,
  },
  genreText: {
    fontSize: 11,
    fontWeight: '500',
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  countText: {
    fontSize: 11,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  emptyText: {
    fontSize: 16,
    marginTop: 14,
    marginBottom: 20,
  },
  importBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
  },
  importBtnText: {
    color: '#ffffff',
    fontWeight: '600',
    marginLeft: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    maxHeight: '90%',
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
    fontSize: 18,
    fontWeight: '700',
  },
  modalBody: {
    padding: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  genrePicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  genreOption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    gap: 8,
  },
  pickDocBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  pickDocText: {
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 6,
  },
  splitCheck: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  splitText: {
    fontSize: 12,
    marginLeft: 6,
  },
  textArea: {
    minHeight: 120,
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    fontSize: 13,
    textAlignVertical: 'top',
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 20,
    marginBottom: 30,
  },
  submitBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
    marginLeft: 8,
  },
});
