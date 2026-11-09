import React, { useState, useEffect } from 'react';
import { StyleSheet, View, StatusBar, Platform } from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { themes, ThemeColors } from './src/theme/theme';
import { NexusDatabase } from './src/storage/db';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { NovelDetailScreen } from './src/screens/NovelDetailScreen';
import { ReaderScreen } from './src/screens/ReaderScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';

type ScreenName = 'library' | 'novel_detail' | 'reader' | 'settings';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<ScreenName>('library');
  const [selectedNovelId, setSelectedNovelId] = useState<string | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [themeKey, setThemeKey] = useState<'dark' | 'light' | 'sepia' | 'oled'>('dark');

  useEffect(() => {
    // Load initial settings and initialize demo data
    const initApp = async () => {
      await NexusDatabase.initializeSampleDataIfEmpty();
      const settings = await NexusDatabase.getSettings();
      if (settings.readerTheme) {
        setThemeKey(settings.readerTheme);
      }
    };
    initApp();
  }, []);

  const handleThemeChange = async (newTheme: 'dark' | 'light' | 'sepia' | 'oled') => {
    setThemeKey(newTheme);
    await NexusDatabase.saveSettings({ readerTheme: newTheme });
  };

  const colors: ThemeColors = themes[themeKey];
  const isLightMode = themeKey === 'light' || themeKey === 'sepia';

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
        <ExpoStatusBar style={isLightMode ? 'dark' : 'light'} />
        <View style={[styles.content, { backgroundColor: colors.background }]}>
          {currentScreen === 'library' && (
            <LibraryScreen
              colors={colors}
              onOpenNovel={(novelId) => {
                setSelectedNovelId(novelId);
                setCurrentScreen('novel_detail');
              }}
              onOpenSettings={() => setCurrentScreen('settings')}
            />
          )}

          {currentScreen === 'novel_detail' && selectedNovelId && (
            <NovelDetailScreen
              novelId={selectedNovelId}
              colors={colors}
              onBack={() => setCurrentScreen('library')}
              onOpenReader={(novelId, chapterId) => {
                setSelectedNovelId(novelId);
                setSelectedChapterId(chapterId);
                setCurrentScreen('reader');
              }}
              onOpenSettings={() => setCurrentScreen('settings')}
            />
          )}

          {currentScreen === 'reader' && selectedNovelId && selectedChapterId && (
            <ReaderScreen
              novelId={selectedNovelId}
              chapterId={selectedChapterId}
              colors={colors}
              currentThemeKey={themeKey}
              onBack={() => setCurrentScreen('novel_detail')}
              onThemeChange={handleThemeChange}
              onSwitchChapter={(chapId) => setSelectedChapterId(chapId)}
            />
          )}

          {currentScreen === 'settings' && (
            <SettingsScreen
              colors={colors}
              onBack={() => {
                if (selectedNovelId) {
                  setCurrentScreen('novel_detail');
                } else {
                  setCurrentScreen('library');
                }
              }}
            />
          )}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
});
