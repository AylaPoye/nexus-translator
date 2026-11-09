import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeColors } from '../theme/theme';
import { LineResult } from '../core/nexus_translator_core';

interface LineItemProps {
  line: LineResult;
  colors: ThemeColors;
  displayMode: 'thai_only' | 'bilingual' | 'chinese_only';
  fontSize: number;
  lineHeightMultiplier: number;
  isActive: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

export const LineItem: React.FC<LineItemProps> = ({
  line,
  colors,
  displayMode,
  fontSize,
  lineHeightMultiplier,
  isActive,
  onPress,
  onLongPress,
}) => {
  const hasIssues = line.issues && line.issues.length > 0;
  const computedLineHeight = fontSize * lineHeightMultiplier;

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[
        styles.container,
        isActive && {
          backgroundColor: colors.readerHighlight,
          borderLeftColor: colors.primary,
          borderLeftWidth: 3,
        },
      ]}
    >
      {/* Chinese Source in Bilingual or Chinese Only mode */}
      {(displayMode === 'bilingual' || displayMode === 'chinese_only') && (
        <Text
          style={[
            styles.sourceText,
            {
              color: colors.readerSourceText,
              fontSize: displayMode === 'chinese_only' ? fontSize : fontSize * 0.85,
              lineHeight: displayMode === 'chinese_only' ? computedLineHeight : computedLineHeight * 0.85,
              marginBottom: displayMode === 'bilingual' ? 4 : 0,
            },
          ]}
        >
          {line.source}
        </Text>
      )}

      {/* Thai Translation in Bilingual or Thai Only mode */}
      {(displayMode === 'bilingual' || displayMode === 'thai_only') && (
        <View style={styles.thaiRow}>
          <Text
            style={[
              styles.translatedText,
              {
                color: colors.readerText,
                fontSize: fontSize,
                lineHeight: computedLineHeight,
              },
            ]}
          >
            {line.translated || '... (ยังไม่ได้แปล)'}
          </Text>

          {hasIssues && (
            <View style={styles.issueIconWrap}>
              <Ionicons name="warning-outline" size={14} color={colors.warning} />
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
    marginVertical: 2,
  },
  sourceText: {
    fontFamily: 'System',
    opacity: 0.85,
  },
  thaiRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  translatedText: {
    flex: 1,
    fontFamily: 'System',
  },
  issueIconWrap: {
    marginLeft: 6,
    marginTop: 4,
  },
});
