import React from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useSelection, PathStep } from '@/context/SelectionContext';

function roleColor(role: string, colors: ReturnType<typeof useColors>): string {
  switch (role) {
    case 'TARGET': return colors.primary;
    case 'GATEKEEPER': return colors.amber;
    case 'ASSET': return colors.secondary;
    default: return colors.mutedForeground;
  }
}

function roleIcon(role: string): string {
  switch (role) {
    case 'TARGET': return 'crosshair';
    case 'GATEKEEPER': return 'shield';
    case 'ASSET': return 'briefcase';
    default: return 'circle';
  }
}

function PathStepCard({ step, index, total, colors }: {
  step: PathStep;
  index: number;
  total: number;
  colors: ReturnType<typeof useColors>;
}) {
  const accent = roleColor(step.role, colors);
  return (
    <View style={styles.stepRow}>
      {index < total - 1 && <View style={[styles.connector, { backgroundColor: colors.border }]} />}
      <View style={[styles.stepCircle, { backgroundColor: accent + '22', borderColor: accent }]}>
        <Text style={[styles.stepNumber, { color: accent, fontFamily: 'Inter_700Bold' }]}>{index + 1}</Text>
      </View>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: accent + '66' }]}>
        <View style={styles.cardHeader}>
          <View style={[styles.rolePill, { backgroundColor: accent + '22', borderColor: accent + '55' }]}>
            <Feather name={roleIcon(step.role) as any} size={10} color={accent} />
            <Text style={[styles.roleText, { color: accent, fontFamily: 'Inter_600SemiBold' }]}>{step.role}</Text>
          </View>
          {step.registry && (
            <Text style={[styles.registry, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>
              {step.registry}
            </Text>
          )}
        </View>
        <Text style={[styles.label, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{step.label}</Text>
        <Text style={[styles.nodeType, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>{step.nodeType}</Text>
        {step.actionRequired && (
          <View style={[styles.reviewBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[styles.reviewText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              Review: {step.actionRequired}
            </Text>
          </View>
        )}
        {(step.contactEmail || step.contactPhone) && (
          <Text style={[styles.evidenceText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Public contact vector recorded — attribution and personal access are not established.
          </Text>
        )}
      </View>
    </View>
  );
}

function ContactEvidenceStrip({ entityId, colors }: {
  entityId: number | null;
  colors: ReturnType<typeof useColors>;
}) {
  const [loading, setLoading] = React.useState(false);
  const [contact, setContact] = React.useState<{ email?: string | null; phone?: string | null; linkedinUrl?: string | null } | null>(null);

  React.useEffect(() => {
    if (!entityId) {
      setContact(null);
      return;
    }
    let active = true;
    setLoading(true);
    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    fetch(`https://${domain}/api/entities/${entityId}`, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (active) setContact(data ? {
          email: data.email,
          phone: data.phone,
          linkedinUrl: data.linkedinUrl,
        } : null);
      })
      .catch(() => { if (active) setContact(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [entityId]);

  const values = [contact?.email, contact?.phone, contact?.linkedinUrl].filter(Boolean);
  return (
    <View style={[styles.evidenceStrip, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
      <View style={styles.evidenceHeader}>
        <Feather name="database" size={12} color={colors.primary} />
        <Text style={[styles.evidenceLabel, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>PUBLIC EVIDENCE</Text>
        <Text style={[styles.evidenceMeta, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          {loading ? 'checking…' : `${values.length} vector${values.length === 1 ? '' : 's'}`}
        </Text>
      </View>
      <Text style={[styles.evidenceCaption, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
        Stored vectors are research evidence only. No contact action is available in Apex Atlas.
      </Text>
    </View>
  );
}

export default function ApproachScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { latestSession, selectedEntityId } = useSelection();
  const topPadding = Platform.OS === 'web' ? 0 : insets.top;

  if (!latestSession) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPadding + 16, borderBottomColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>EVIDENCE PATH</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>No active session</Text>
        </View>
        <View style={styles.empty}>
          <Feather name="map" size={36} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>No session yet</Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Select a target from Targets,{'\n'}then run MCTS to review{'\n'}its evidence path.
          </Text>
        </View>
      </View>
    );
  }

  const { targetEntityName, winningPath, pathScore } = latestSession;
  const intermediary = winningPath.find((step) => step.role === 'GATEKEEPER');

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 6, borderBottomColor: colors.border, backgroundColor: colors.card }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>EVIDENCE PATH</Text>
          {targetEntityName && (
            <Text style={[styles.headerSub, { color: colors.amber, fontFamily: 'Inter_500Medium' }]}>
              TARGET: {targetEntityName.toUpperCase()}
            </Text>
          )}
        </View>
        <View style={[styles.scorePill, { backgroundColor: colors.primary + '22', borderColor: colors.primary + '44' }]}>
          <Text style={[styles.scoreText, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>{(pathScore * 100).toFixed(0)}</Text>
          <Text style={[styles.scoreLabel, { color: colors.primary, fontFamily: 'Inter_400Regular' }]}>PATH SCORE</Text>
        </View>
      </View>

      <ContactEvidenceStrip entityId={selectedEntityId} colors={colors} />

      {intermediary && (
        <View style={[styles.intermediaryStrip, { backgroundColor: colors.amber + '11', borderBottomColor: colors.amber + '33' }]}>
          <Feather name="shield" size={13} color={colors.amber} />
          <Text style={[styles.intermediaryText, { color: colors.amber, fontFamily: 'Inter_500Medium' }]}>
            Intermediary candidate: <Text style={{ fontFamily: 'Inter_700Bold' }}>{intermediary.label}</Text>
          </Text>
        </View>
      )}

      <ScrollView contentContainerStyle={[styles.pathList, { paddingBottom: insets.bottom + 32 }]}>
        {winningPath.map((step, index) => (
          <PathStepCard key={step.vertexId} step={step} index={index} total={winningPath.length} colors={colors} />
        ))}
        <View style={[styles.boundary, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Feather name="shield" size={15} color={colors.primary} />
          <Text style={[styles.boundaryText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Evidence path only. Attribution and access remain in analyst review; Apex Atlas does not create communication artifacts.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 10, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', borderBottomWidth: 1 },
  headerTitle: { fontSize: 16, letterSpacing: 3 },
  headerSub: { fontSize: 12, marginTop: 3, letterSpacing: 1 },
  scorePill: { alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, marginBottom: 2 },
  scoreText: { fontSize: 22 },
  scoreLabel: { fontSize: 8, letterSpacing: 1.2 },
  evidenceStrip: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, gap: 5 },
  evidenceHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  evidenceLabel: { fontSize: 10, letterSpacing: 1.2 },
  evidenceMeta: { marginLeft: 'auto', fontSize: 10 },
  evidenceCaption: { fontSize: 11, lineHeight: 16 },
  evidenceText: { fontSize: 11, lineHeight: 16, marginTop: 4 },
  intermediaryStrip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 8, borderBottomWidth: 1 },
  intermediaryText: { fontSize: 13, flex: 1 },
  pathList: { padding: 20 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start' },
  connector: { position: 'absolute', left: 18, top: 38, bottom: -10, width: 1.5 },
  stepCircle: { width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginRight: 12, marginTop: 2, flexShrink: 0 },
  stepNumber: { fontSize: 14 },
  card: { flex: 1, borderRadius: 8, borderWidth: 1, padding: 14, marginBottom: 24, gap: 6 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rolePill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 3, borderWidth: 1 },
  roleText: { fontSize: 9, letterSpacing: 1 },
  registry: { fontSize: 10, maxWidth: 140 },
  label: { fontSize: 15 },
  nodeType: { fontSize: 11 },
  reviewBox: { borderRadius: 4, borderWidth: 1, padding: 8, marginTop: 2 },
  reviewText: { fontSize: 12, lineHeight: 18 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  emptyTitle: { fontSize: 18 },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
  boundary: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderRadius: 8, padding: 12, marginTop: 4 },
  boundaryText: { flex: 1, fontSize: 12, lineHeight: 18 },
});