import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ThemeColors } from '../theme/theme';
import { audioService, AudioPlaybackState } from '../services/audioService';
import { SceneId } from '../core/nexus_translator_core';

interface RadioDramaBarProps {
  colors: ThemeColors;
  onLineChange?: (lineIndex: number) => void;
}

const SCENE_NAMES: Record<SceneId, { label: string; icon: string }> = {
  RAIN: { label: 'สายฝน', icon: 'rainy-outline' },
  STORM: { label: 'พายุคลั่ง', icon: 'thunderstorm-outline' },
  FOREST: { label: 'ป่าทึบ', icon: 'leaf-outline' },
  CAVE: { label: 'ถ้ำลึกลับ', icon: 'earth-outline' },
  BATTLE: { label: 'ศึกประจัญ', icon: 'flash-outline' },
  FIRE: { label: 'เพลิงผลาญ', icon: 'flame-outline' },
  NIGHT: { label: 'ราตรีกาล', icon: 'moon-outline' },
  CROWD: { label: 'ตลาดพลุกพล่าน', icon: 'people-outline' },
  BREAKTHROUGH: { label: 'ทะลวงด่าน', icon: 'sparkles-outline' },
  TENSION: { label: 'ตึงเครียด', icon: 'alert-circle-outline' },
  SADNESS: { label: 'โศกศัลย์', icon: 'water-outline' },
};

const SPEEDS = [0.75, 1.0, 1.25, 1.5, 2.0];

export const RadioDramaBar: React.FC<RadioDramaBarProps> = ({ colors, onLineChange }) => {
  const [state, setState] = useState<AudioPlaybackState>({
    isPlaying: false,
    isPaused: false,
    currentLineIndex: 0,
    totalLines: 0,
    speed: 1.0,
  });
  const [radioEnabled, setRadioEnabled] = useState(true);

  useEffect(() => {
    const unsub = audioService.addListener((newState) => {
      setState(newState);
      if (onLineChange && newState.isPlaying) {
        onLineChange(newState.currentLineIndex);
      }
    });
    return () => {
      unsub();
    };
  }, [onLineChange]);

  const togglePlay = () => {
    if (state.isPlaying && !state.isPaused) {
      audioService.pause();
    } else {
      audioService.resume();
    }
  };

  const nextSpeed = () => {
    const currentIdx = SPEEDS.indexOf(state.speed);
    const nextIdx = (currentIdx + 1) % SPEEDS.length;
    const newSpeed = SPEEDS[nextIdx];
    audioService.setSpeed(newSpeed);
  };

  const toggleRadio = () => {
    const next = !radioEnabled;
    setRadioEnabled(next);
    audioService.setRadioDramaEnabled(next);
  };

  const prevLine = () => {
    if (state.currentLineIndex > 0) {
      audioService.seekToLine(state.currentLineIndex - 1);
    }
  };

  const nextLine = () => {
    if (state.currentLineIndex < state.totalLines - 1) {
      audioService.seekToLine(state.currentLineIndex + 1);
    }
  };

  if (!state.isPlaying && !state.isPaused && state.totalLines === 0) {
    return null;
  }

  const currentSceneInfo = state.currentScene ? SCENE_NAMES[state.currentScene] : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderTopColor: colors.cardBorder }]}>
      <View style={styles.topRow}>
        <View style={styles.indicatorWrap}>
          <Text style={[styles.lineText, { color: colors.textSecondary }]}>
            บรรทัด {state.currentLineIndex + 1} / {state.totalLines}
          </Text>
          {currentSceneInfo && radioEnabled && (
            <View style={[styles.sceneBadge, { backgroundColor: colors.primaryLight }]}>
              <Ionicons name={currentSceneInfo.icon as any} size={14} color={colors.primary} />
              <Text style={[styles.sceneText, { color: colors.primary }]}>{currentSceneInfo.label}</Text>
            </View>
          )}
        </View>

        <View style={styles.optionControls}>
          <TouchableOpacity
            style={[styles.smallBtn, { backgroundColor: radioEnabled ? colors.primaryLight : colors.border }]}
            onPress={toggleRadio}
          >
            <Ionicons
              name={radioEnabled ? 'musical-notes' : 'musical-note-outline'}
              size={16}
              color={radioEnabled ? colors.primary : colors.textMuted}
            />
            <Text style={[styles.smallBtnText, { color: radioEnabled ? colors.primary : colors.textMuted }]}>
              {radioEnabled ? 'ดนตรีเปิด' : 'ดนตรีปิด'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.smallBtn, { backgroundColor: colors.primaryLight }]}
            onPress={nextSpeed}
          >
            <Text style={[styles.smallBtnText, { color: colors.primary }]}>{state.speed}x</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.controlsRow}>
        <TouchableOpacity onPress={prevLine} style={styles.navBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="play-skip-back" size={20} color={colors.text} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={togglePlay}
          style={[styles.playBtn, { backgroundColor: colors.primary }]}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons
            name={state.isPlaying && !state.isPaused ? 'pause' : 'play'}
            size={24}
            color="#ffffff"
          />
        </TouchableOpacity>

        <TouchableOpacity onPress={nextLine} style={styles.navBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="play-skip-forward" size={20} color={colors.text} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => audioService.stop()}
          style={styles.stopBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="square" size={18} color={colors.danger} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.15,
    shadowRadius: 5,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  indicatorWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lineText: {
    fontSize: 12,
    fontWeight: '500',
  },
  sceneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginLeft: 8,
  },
  sceneText: {
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 4,
  },
  optionControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  smallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginLeft: 8,
  },
  smallBtnText: {
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 2,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtn: {
    padding: 8,
    marginHorizontal: 16,
  },
  playBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopBtn: {
    padding: 8,
    marginLeft: 24,
  },
});
