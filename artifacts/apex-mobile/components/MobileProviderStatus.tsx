import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

type KeySlot = { state: 'active' | 'rate_limited' | 'missing' };
type ProviderStatus = {
  groq?: KeySlot[];
  perplexity?: KeySlot[];
  gemini?: KeySlot[];
  tavily?: KeySlot[];
  exa?: KeySlot[];
};

type SystemStatus = {
  ai?: ProviderStatus;
  openResearch?: {
    state: 'ready' | 'incomplete' | 'unavailable';
    huggingFace: { configured: boolean };
    serper: { configured: boolean };
    adapter: { available: boolean; model: string };
  };
};

const POLL_INTERVAL_MS = 15_000;

function countKeys(ai: ProviderStatus | undefined) {
  const slots = Object.values(ai ?? {}).flatMap((provider) => provider ?? []);
  return {
    active: slots.filter((slot) => slot.state === 'active').length,
    configured: slots.filter((slot) => slot.state !== 'missing').length,
  };
}

export function MobileProviderStatus() {
  const colors = useColors();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    const refresh = async () => {
      const domain = process.env.EXPO_PUBLIC_DOMAIN;
      if (!domain) {
        if (mounted) setLoading(false);
        return;
      }
      try {
        const response = await fetch(`https://${domain}/api/system/status`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const next = await response.json() as SystemStatus;
        if (mounted) setStatus(next);
      } catch {
        // Keep the last good snapshot visible during transient mobile network gaps.
      } finally {
        if (mounted) setLoading(false);
      }
    };

    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      mounted = false;
      controller.abort();
      clearInterval(interval);
    };
  }, []);

  const keys = useMemo(() => countKeys(status?.ai), [status]);
  const openResearch = status?.openResearch;
  const openResearchReady = openResearch?.state === 'ready';
  const openResearchIncomplete = openResearch?.state === 'incomplete';
  const openLabel = loading && !status
    ? 'HF/S —'
    : `HF/S ${openResearchReady ? 'OK' : openResearchIncomplete ? '!' : '—'}`;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Open provider status"
        testID="button-mobile-provider-status"
        style={({ pressed }) => [
          styles.trigger,
          {
            backgroundColor: colors.background,
            borderColor: openResearchReady ? `${colors.primary}55` : openResearchIncomplete ? `${colors.amber}66` : colors.border,
            opacity: pressed ? 0.72 : 1,
          },
        ]}
      >
        {loading && !status ? (
          <ActivityIndicator size="small" color={colors.mutedForeground} />
        ) : (
          <View style={[styles.dot, { backgroundColor: openResearchReady ? colors.primary : openResearchIncomplete ? colors.amber : colors.mutedForeground }]} />
        )}
        <Text style={[styles.triggerText, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
          WEB {keys.active}/{keys.configured || '—'}
        </Text>
        <Text style={[styles.openText, { color: openResearchReady ? colors.primary : openResearchIncomplete ? colors.amber : colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>
          {openLabel}
        </Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={styles.panelHeader}>
              <View style={styles.panelTitleRow}>
                <Feather name="activity" size={16} color={colors.primary} />
                <View>
                  <Text style={[styles.panelTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
                    PROVIDER STATUS
                  </Text>
                  <Text style={[styles.panelSubtitle, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                    Live capacity · review-only research
                  </Text>
                </View>
              </View>
              <Pressable onPress={() => setOpen(false)} hitSlop={10} accessibilityLabel="Close provider status">
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>

            <View style={[styles.summary, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <View>
                <Text style={[styles.kicker, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>WEB OSINT</Text>
                <Text style={[styles.summaryValue, { color: keys.active > 0 ? colors.primary : colors.amber, fontFamily: 'Inter_700Bold' }]}>
                  {keys.active}/{keys.configured || '—'} active
                </Text>
              </View>
              <View style={styles.summaryRight}>
                <Text style={[styles.kicker, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>OPEN RESEARCH</Text>
                <Text style={[styles.summaryValue, { color: openResearchReady ? colors.primary : openResearchIncomplete ? colors.amber : colors.mutedForeground, fontFamily: 'Inter_700Bold' }]}>
                  {openResearch?.state?.toUpperCase() ?? 'LOADING'}
                </Text>
              </View>
            </View>

            <View style={[styles.detailCard, { borderColor: colors.border }]}>
              <StatusLine label="Hugging Face model" configured={Boolean(openResearch?.huggingFace.configured)} colors={colors} />
              <StatusLine label="Serper live search" configured={Boolean(openResearch?.serper.configured)} colors={colors} />
              <View style={styles.adapterRow}>
                <Text style={[styles.detailLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>smolagents adapter</Text>
                <Text style={[styles.detailValue, { color: openResearch?.adapter.available ? colors.primary : colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>
                  {openResearch?.adapter.available ? 'installed' : 'unavailable'}
                </Text>
              </View>
            </View>

            <Text style={[styles.note, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              Open Research is optional and remains bounded, review-only, and separate from ordinary web key capacity.
            </Text>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function StatusLine({
  label,
  configured,
  colors,
}: {
  label: string;
  configured: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.adapterRow}>
      <Text style={[styles.detailLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: configured ? colors.primary : colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>
        {configured ? 'configured' : 'missing'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: 30,
    maxWidth: 170,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderRadius: 7,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  triggerText: { fontSize: 9, letterSpacing: 0.3 },
  openText: { flexShrink: 0, fontSize: 8, letterSpacing: 0.1 },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    paddingTop: 74,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  panel: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  panelHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 },
  panelTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  panelTitle: { fontSize: 12, letterSpacing: 1.4 },
  panelSubtitle: { fontSize: 10, marginTop: 2 },
  summary: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, borderWidth: 1, borderRadius: 9, padding: 11, marginBottom: 10 },
  summaryRight: { alignItems: 'flex-end' },
  kicker: { fontSize: 9, letterSpacing: 1.1 },
  summaryValue: { fontSize: 13, marginTop: 3 },
  detailCard: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 11, paddingVertical: 4 },
  adapterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 8 },
  detailLabel: { fontSize: 11, flexShrink: 1 },
  detailValue: { fontSize: 10, textTransform: 'uppercase' },
  note: { fontSize: 10, lineHeight: 15, marginTop: 12 },
});