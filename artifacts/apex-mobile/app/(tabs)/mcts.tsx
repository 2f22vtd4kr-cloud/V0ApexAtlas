import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useRunResearch } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useSelection, MctsStep, PathStep } from '@/context/SelectionContext';
import { MobileProviderStatus } from '@/components/MobileProviderStatus';

// ─── Role color helper ────────────────────────────────────────────────────────

function roleColor(role: string, colors: ReturnType<typeof useColors>): string {
  switch (role) {
    case 'TARGET': return colors.primary;
    case 'GATEKEEPER': return colors.amber;
    case 'ASSET': return colors.secondary;
    default: return colors.mutedForeground;
  }
}

// ─── Terminal log line ────────────────────────────────────────────────────────

function TerminalLine({ step, colors }: { step: MctsStep; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={termStyles.line}>
      <Text style={[termStyles.stepNum, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
        [{String(step.step).padStart(3, '0')}]
      </Text>
      <View style={termStyles.lineBody}>
        <Text style={[termStyles.action, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>
          {step.action}
        </Text>
        <Text style={[termStyles.arrow, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          {' → '}
        </Text>
        <Text style={[termStyles.target, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
          {step.target}
        </Text>
        <Text style={[termStyles.meta, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          {' '}UCT:{step.uctScore.toFixed(3)} W:{step.warmthScore.toFixed(0)}%
        </Text>
      </View>
    </View>
  );
}

// ─── Path node card (horizontal) ─────────────────────────────────────────────

function PathNodeCard({ step, colors }: { step: PathStep; colors: ReturnType<typeof useColors> }) {
  const rc = roleColor(step.role, colors);
  return (
    <View style={[pathStyles.card, { backgroundColor: colors.card, borderColor: rc + '66' }]}>
      <View style={[pathStyles.rolePill, { backgroundColor: rc + '22' }]}>
        <Text style={[pathStyles.roleText, { color: rc, fontFamily: 'Inter_600SemiBold' }]}>
          {step.role}
        </Text>
      </View>
      <Text style={[pathStyles.label, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]} numberOfLines={2}>
        {step.label}
      </Text>
      <Text style={[pathStyles.nodeType, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>
        {step.nodeType}
      </Text>
      {step.actionRequired && (
        <Text style={[pathStyles.action, { color: rc, fontFamily: 'Inter_400Regular' }]} numberOfLines={2}>
          {step.actionRequired}
        </Text>
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function MctsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { selectedEntityId, selectedEntityName, setLatestSession } = useSelection();

  const [steps, setSteps] = useState<MctsStep[]>([]);
  const [winningPath, setWinningPath] = useState<PathStep[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const runResearch = useRunResearch();

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const handleRun = useCallback(() => {
    if (!selectedEntityId || isStreaming) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setSteps([]);
    setWinningPath([]);
    setIsComplete(false);
    setError(null);
    setIsStreaming(true);

    runResearch.mutate(
      { data: { entityId: selectedEntityId, depth: 4 } },
      {
        onSuccess: (data) => {
          // Parse raw API payload
          let allSteps: MctsStep[] = [];
          let path: PathStep[] = [];
          try { allSteps = JSON.parse(data.mctsSteps ?? '[]'); } catch { /* ok */ }
          try { path = JSON.parse(data.winningPath ?? '[]'); } catch { /* ok */ }

          // Stream steps one-by-one for terminal effect
          let i = 0;
          intervalRef.current = setInterval(() => {
            if (i >= allSteps.length) {
              if (intervalRef.current) clearInterval(intervalRef.current);
              setWinningPath(path);
              setIsComplete(true);
              setIsStreaming(false);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setLatestSession({
                id: data.id,
                targetEntityName: data.targetEntityName ?? null,
                winningPath: path,
                mctsSteps: allSteps,
                pathScore: data.pathScore ?? 0,
              });
              return;
            }
            setSteps((prev) => [...prev, allSteps[i]]);
            i++;
            scrollRef.current?.scrollToEnd({ animated: false });
          }, 110);
        },
        onError: (err: any) => {
          setIsStreaming(false);
          setError(err?.message ?? 'MCTS run failed. Check API connection.');
        },
      },
    );
  }, [selectedEntityId, isStreaming, runResearch, setLatestSession]);

  const webTopPadding = 0;
  const webBottomPadding = 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 6 + webTopPadding,
            borderBottomColor: colors.border,
            backgroundColor: colors.card,
          },
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            MCTS TERMINAL
          </Text>
          {selectedEntityName ? (
            <Text style={[styles.targetLabel, { color: colors.amber, fontFamily: 'Inter_500Medium' }]}>
              TARGET: {selectedEntityName.toUpperCase()}
            </Text>
          ) : (
            <Text style={[styles.targetLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              No target selected — go to Targets
            </Text>
          )}
        </View>
        <View style={styles.headerActions}>
          <MobileProviderStatus />
          {isStreaming && <ActivityIndicator color={colors.primary} size="small" />}
          {isComplete && (
            <View style={[styles.completeBadge, { backgroundColor: colors.primary + '22', borderColor: colors.primary + '44' }]}>
              <Text style={[styles.completeBadgeText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>
                DONE
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Terminal area */}
      <ScrollView
        ref={scrollRef}
        style={[styles.terminal, { backgroundColor: '#080C16' }]}
        contentContainerStyle={styles.terminalContent}
        showsVerticalScrollIndicator={false}
      >
        {steps.length === 0 && !isStreaming && (
          <Text style={[styles.terminalPrompt, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {selectedEntityId
              ? '// Press INITIALIZE to begin MCTS computation\n// Monte Carlo Tree Search will map optimal approach vectors'
              : '// Select a target entity from the Targets tab\n// then return here to run MCTS analysis'}
          </Text>
        )}
        {steps.map((step) => (
          <TerminalLine key={step.step} step={step} colors={colors} />
        ))}
        {isStreaming && (
          <View style={styles.cursorRow}>
            <Text style={[styles.cursor, { color: colors.primary, fontFamily: 'Inter_400Regular' }]}>█</Text>
          </View>
        )}
        {error && (
          <View style={styles.errorRow}>
            <Feather name="alert-triangle" size={14} color={colors.destructive} />
            <Text style={[styles.errorLine, { color: colors.destructive, fontFamily: 'Inter_400Regular' }]}>
              {error}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Winning path horizontal scroll (shown after completion) */}
      {isComplete && winningPath.length > 0 && (
        <View style={[styles.pathSection, { backgroundColor: colors.muted, borderTopColor: colors.border }]}>
          <Text style={[styles.pathLabel, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>
            WINNING PATH
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pathScroll}>
            {winningPath.map((step, i) => (
              <React.Fragment key={step.vertexId}>
                <PathNodeCard step={step} colors={colors} />
                {i < winningPath.length - 1 && (
                  <View style={styles.pathArrow}>
                    <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                  </View>
                )}
              </React.Fragment>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Bottom controls */}
      <View
        style={[
          styles.controls,
          {
            paddingBottom: insets.bottom + 58 + webBottomPadding,
            borderTopColor: colors.border,
            backgroundColor: colors.card,
          },
        ]}
      >
        <Pressable
          onPress={handleRun}
          disabled={!selectedEntityId || isStreaming}
          style={({ pressed }) => [
            styles.runButton,
            {
              backgroundColor:
                !selectedEntityId || isStreaming
                  ? colors.muted
                  : pressed
                  ? colors.primary + 'CC'
                  : colors.primary,
              borderColor: selectedEntityId && !isStreaming ? colors.primary : colors.border,
            },
          ]}
        >
          {isStreaming ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Feather name="cpu" size={16} color={!selectedEntityId ? colors.mutedForeground : '#fff'} />
          )}
          <Text
            style={[
              styles.runButtonText,
              {
                color: !selectedEntityId || isStreaming ? colors.mutedForeground : '#fff',
                fontFamily: 'Inter_700Bold',
              },
            ]}
          >
            {isStreaming ? 'COMPUTING...' : isComplete ? 'RE-RUN MCTS' : 'INITIALIZE MCTS'}
          </Text>
        </Pressable>

        {isComplete && (
          <Pressable
            onPress={() => router.navigate('/(tabs)/approach')}
            style={({ pressed }) => [
              styles.approachButton,
              {
                backgroundColor: colors.secondary + (pressed ? 'CC' : '22'),
                borderColor: colors.secondary + '66',
              },
            ]}
          >
            <Feather name="map" size={15} color={colors.secondary} />
            <Text style={[styles.approachButtonText, { color: colors.secondary, fontFamily: 'Inter_600SemiBold' }]}>
              View Approach
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  header: {
    paddingHorizontal: 20,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 16, letterSpacing: 3 },
  targetLabel: { fontSize: 12, marginTop: 3, letterSpacing: 1 },
  completeBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, borderWidth: 1, marginBottom: 2 },
  completeBadgeText: { fontSize: 10, letterSpacing: 1.5 },

  terminal: { flex: 1 },
  terminalContent: { padding: 14, gap: 4 },
  terminalPrompt: { fontSize: 12, lineHeight: 20 },
  cursorRow: { paddingTop: 2 },
  cursor: { fontSize: 14 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  errorLine: { flex: 1, fontSize: 12 },

  pathSection: { borderTopWidth: 1, paddingTop: 10, paddingBottom: 12 },
  pathLabel: { fontSize: 10, letterSpacing: 2, paddingHorizontal: 16, marginBottom: 8 },
  pathScroll: { paddingHorizontal: 12, gap: 6, alignItems: 'center' },
  pathArrow: { justifyContent: 'center', paddingBottom: 4 },

  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  runButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 6,
    borderWidth: 1,
  },
  runButtonText: { fontSize: 13, letterSpacing: 1.5 },
  approachButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 6,
    borderWidth: 1,
  },
  approachButtonText: { fontSize: 13 },
});

const termStyles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 1 },
  stepNum: { fontSize: 11, lineHeight: 18, minWidth: 42 },
  lineBody: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  action: { fontSize: 11, lineHeight: 18 },
  arrow: { fontSize: 11, lineHeight: 18 },
  target: { fontSize: 11, lineHeight: 18 },
  meta: { fontSize: 10, lineHeight: 18 },
});

const pathStyles = StyleSheet.create({
  card: {
    width: 150,
    padding: 12,
    borderRadius: 6,
    borderWidth: 1,
    gap: 6,
  },
  rolePill: { alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3 },
  roleText: { fontSize: 9, letterSpacing: 1 },
  label: { fontSize: 13, lineHeight: 18 },
  nodeType: { fontSize: 10 },
  action: { fontSize: 11, lineHeight: 16 },
});
