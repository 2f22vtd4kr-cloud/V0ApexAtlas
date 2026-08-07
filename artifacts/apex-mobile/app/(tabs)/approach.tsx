import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { MobileProviderStatus } from '@/components/MobileProviderStatus';
import { useSelection, PathStep } from '@/context/SelectionContext';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Path step card ───────────────────────────────────────────────────────────

function PathStepCard({ step, index, total, colors }: {
  step: PathStep;
  index: number;
  total: number;
  colors: ReturnType<typeof useColors>;
}) {
  const rc = roleColor(step.role, colors);
  const isGatekeeper = step.role === 'GATEKEEPER';

  return (
    <View style={pathStyles.wrapper}>
      {/* Connector line (not on last) */}
      {index < total - 1 && (
        <View style={[pathStyles.connector, { backgroundColor: colors.border }]} />
      )}

      {/* Step number circle */}
      <View style={[pathStyles.stepCircle, { backgroundColor: rc + '22', borderColor: rc }]}>
        <Text style={[pathStyles.stepNum, { color: rc, fontFamily: 'Inter_700Bold' }]}>
          {index + 1}
        </Text>
      </View>

      {/* Card */}
      <View
        style={[
          pathStyles.card,
          {
            backgroundColor: isGatekeeper ? colors.amber + '0D' : colors.card,
            borderColor: rc + (isGatekeeper ? 'AA' : '55'),
          },
        ]}
      >
        {/* Role badge */}
        <View style={pathStyles.cardHeader}>
          <View style={[pathStyles.rolePill, { backgroundColor: rc + '22', borderColor: rc + '44' }]}>
            <Feather name={roleIcon(step.role) as any} size={10} color={rc} />
            <Text style={[pathStyles.roleText, { color: rc, fontFamily: 'Inter_600SemiBold' }]}>
              {step.role}
            </Text>
          </View>
          {step.registry && (
            <Text style={[pathStyles.registry, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {step.registry}
            </Text>
          )}
        </View>

        {/* Name */}
        <Text style={[pathStyles.label, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
          {step.label}
        </Text>

        {/* Node type */}
        <Text style={[pathStyles.nodeType, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          {step.nodeType}
        </Text>

        {/* Action required */}
        {step.actionRequired && (
          <View style={[pathStyles.actionBox, { backgroundColor: rc + '11', borderColor: rc + '33' }]}>
            <Text style={[pathStyles.actionText, { color: rc, fontFamily: 'Inter_500Medium' }]}>
              {step.actionRequired}
            </Text>
          </View>
        )}

        {/* Contact method */}
        {step.contactMethod && (
          <View style={pathStyles.contactRow}>
            <Feather name="phone" size={12} color={colors.mutedForeground} />
            <Text style={[pathStyles.contactText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {step.contactMethod}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Pitch modal ──────────────────────────────────────────────────────────────

type PitchSequence = { initial: string; followUp: string; introScript: string };
const PITCH_TABS: { key: keyof PitchSequence; label: string; icon: string }[] = [
  { key: 'initial',     label: 'Initial',      icon: 'message-square' },
  { key: 'followUp',   label: 'Follow-Up',    icon: 'clock' },
  { key: 'introScript',label: 'Intro Script', icon: 'users' },
];

function PitchModal({
  visible,
  pitch,
  onClose,
  colors,
}: {
  visible: boolean;
  pitch: string;
  onClose: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<keyof PitchSequence>('initial');

  const sequence: PitchSequence | null = (() => {
    try {
      const p = JSON.parse(pitch) as PitchSequence;
      return p.initial ? p : null;
    } catch { return null; }
  })();

  const activeContent = sequence ? sequence[activeTab] : pitch;

  const handleShare = async () => {
    try {
      await Share.share({ message: activeContent ?? pitch });
    } catch { /* ignore */ }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[pitchStyles.modal, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 }]}>
        {/* Header */}
        <View style={[pitchStyles.modalHeader, { borderBottomColor: colors.border }]}>
          <Text style={[pitchStyles.modalTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            OUTREACH SEQUENCE
          </Text>
          <View style={pitchStyles.headerActions}>
            <Pressable onPress={handleShare} style={[pitchStyles.iconBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Feather name="share" size={15} color={colors.primary} />
            </Pressable>
            <Pressable onPress={onClose} style={[pitchStyles.iconBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Feather name="x" size={15} color={colors.mutedForeground} />
            </Pressable>
          </View>
        </View>

        {/* Tab bar (only when sequence parsed) */}
        {sequence && (
          <View style={[pitchStyles.tabBar, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
            {PITCH_TABS.map((tab) => {
              const active = activeTab === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  onPress={() => setActiveTab(tab.key)}
                  style={[
                    pitchStyles.tab,
                    active && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
                  ]}
                >
                  <Feather name={tab.icon as any} size={12} color={active ? colors.primary : colors.mutedForeground} />
                  <Text style={[
                    pitchStyles.tabText,
                    { color: active ? colors.primary : colors.mutedForeground,
                      fontFamily: active ? 'Inter_600SemiBold' : 'Inter_400Regular' }
                  ]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Pitch content */}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={pitchStyles.pitchContent}>
          <Text style={[pitchStyles.pitchText, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}>
            {activeContent}
          </Text>
        </ScrollView>

        {/* Footer: share + close */}
        <View style={pitchStyles.footer}>
          <Pressable
            onPress={handleShare}
            style={({ pressed }) => [
              pitchStyles.shareButton,
              { backgroundColor: pressed ? colors.primary + 'CC' : colors.primary + 'DD', borderColor: colors.primary },
            ]}
          >
            <Feather name="share-2" size={14} color="#fff" />
            <Text style={[pitchStyles.shareButtonText, { fontFamily: 'Inter_600SemiBold' }]}>
              SHARE THIS PITCH
            </Text>
          </Pressable>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              pitchStyles.closeButton,
              { backgroundColor: pressed ? colors.muted : colors.border },
            ]}
          >
            <Text style={[pitchStyles.closeButtonText, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
              CLOSE
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ─── Contact vectors strip ────────────────────────────────────────────────────

function ContactVectorsStrip({ entityId, colors }: {
  entityId: number | null;
  colors: ReturnType<typeof useColors>;
}) {
  const [contact, setContact] = useState<{
    email?: string | null;
    phone?: string | null;
    linkedinUrl?: string | null;
  } | null>(null);

  useEffect(() => {
    if (!entityId) return;
    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    if (!domain) return;
    fetch(`https://${domain}/api/entities/${entityId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d) setContact({ email: d.email, phone: d.phone, linkedinUrl: d.linkedinUrl });
      })
      .catch(() => {/* ignore */});
  }, [entityId]);

  const hasContact = contact && (contact.email || contact.phone || contact.linkedinUrl);

  if (!entityId) return null;

  return (
    <View style={[cvStyles.strip, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
      <Text style={[cvStyles.label, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>
        DIRECT CONTACT
      </Text>
      {!contact ? (
        <Text style={[cvStyles.muted, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          Loading…
        </Text>
      ) : !hasContact ? (
        <Text style={[cvStyles.muted, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          No contact data — run Enrich from the web app profile.
        </Text>
      ) : (
        <View style={cvStyles.row}>
          {contact.email && (
            <TouchableOpacity
              onPress={() => Linking.openURL(`mailto:${contact.email}`)}
              style={[cvStyles.pill, { borderColor: colors.primary + '44', backgroundColor: colors.primary + '15' }]}
            >
              <Feather name="mail" size={11} color={colors.primary} />
              <Text style={[cvStyles.pillText, { color: colors.primary, fontFamily: 'Inter_500Medium' }]} numberOfLines={1}>
                {contact.email}
              </Text>
            </TouchableOpacity>
          )}
          {contact.phone && (
            <TouchableOpacity
              onPress={() => Linking.openURL(`tel:${contact.phone}`)}
              style={[cvStyles.pill, { borderColor: colors.secondary + '44', backgroundColor: colors.secondary + '15' }]}
            >
              <Feather name="phone" size={11} color={colors.secondary} />
              <Text style={[cvStyles.pillText, { color: colors.secondary, fontFamily: 'Inter_500Medium' }]}>
                {contact.phone}
              </Text>
            </TouchableOpacity>
          )}
          {contact.linkedinUrl && (
            <TouchableOpacity
              onPress={() => Linking.openURL(contact.linkedinUrl!)}
              style={[cvStyles.pill, { borderColor: '#60A5FA44', backgroundColor: '#60A5FA15' }]}
            >
              <Feather name="linkedin" size={11} color="#60A5FA" />
              <Text style={[cvStyles.pillText, { color: '#60A5FA', fontFamily: 'Inter_500Medium' }]}>
                LinkedIn
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const cvStyles = StyleSheet.create({
  strip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 6,
    borderBottomWidth: 1,
  },
  label: { fontSize: 9, letterSpacing: 2, marginBottom: 4 },
  muted: { fontSize: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  pillText: { fontSize: 12 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ApproachScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { latestSession, selectedEntityId } = useSelection();
  const [isGeneratingPitch, setIsGeneratingPitch] = useState(false);
  const [pitchText, setPitchText] = useState<string | null>(null);
  const [pitchVisible, setPitchVisible] = useState(false);
  const [pitchError, setPitchError] = useState<string | null>(null);

  const webTopPadding = 0;
  const webBottomPadding = 0;

  const handleGeneratePitch = async () => {
    if (!latestSession || isGeneratingPitch) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsGeneratingPitch(true);
    setPitchError(null);
    try {
      const domain = process.env.EXPO_PUBLIC_DOMAIN;
      const resp = await fetch(
        `https://${domain}/api/research/sessions/${latestSession.id}/pitch`,
        { method: 'POST' },
      );
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? 'Pitch generation failed');
      const pitch = data.generatedPitch ?? '';
      setPitchText(pitch);
      setPitchVisible(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      setPitchError(err.message ?? 'Failed to generate pitch.');
    } finally {
      setIsGeneratingPitch(false);
    }
  };

  // ── No session state ──────────────────────────────────────────────────────
  if (!latestSession) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 16 + webTopPadding, borderBottomColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            APPROACH VECTOR
          </Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            No active session
          </Text>
        </View>
        <View style={styles.empty}>
          <Feather name="map" size={36} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
            No session yet
          </Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Select a target from Targets,{'\n'}then run MCTS to generate{'\n'}an approach vector.
          </Text>
        </View>
      </View>
    );
  }

  const { targetEntityName, winningPath, pathScore } = latestSession;
  const gatekeeper = winningPath.find((s) => s.role === 'GATEKEEPER');

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
            APPROACH VECTOR
          </Text>
          {targetEntityName && (
            <Text style={[styles.headerSub, { color: colors.amber, fontFamily: 'Inter_500Medium' }]}>
              TARGET: {targetEntityName.toUpperCase()}
            </Text>
          )}
        </View>
        <View style={styles.headerActions}>
          <MobileProviderStatus />
          <View style={[styles.scorePill, { backgroundColor: colors.primary + '22', borderColor: colors.primary + '44' }]}>
            <Text style={[styles.scoreText, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>
              {(pathScore * 100).toFixed(0)}
            </Text>
            <Text style={[styles.scoreLabel, { color: colors.primary, fontFamily: 'Inter_400Regular' }]}>
              SCORE
            </Text>
          </View>
        </View>
      </View>

      {/* Contact vectors strip */}
      <ContactVectorsStrip entityId={selectedEntityId} colors={colors} />

      {/* Gatekeeper highlight strip */}
      {gatekeeper && (
        <View style={[styles.gatekeeperStrip, { backgroundColor: colors.amber + '11', borderBottomColor: colors.amber + '33' }]}>
          <Feather name="shield" size={13} color={colors.amber} />
          <Text style={[styles.gatekeeperText, { color: colors.amber, fontFamily: 'Inter_500Medium' }]}>
            Key gatekeeper:{' '}
            <Text style={{ fontFamily: 'Inter_700Bold' }}>{gatekeeper.label}</Text>
          </Text>
          {gatekeeper.contactMethod && (
            <Text style={[styles.gatekeeperContact, { color: colors.amber, fontFamily: 'Inter_400Regular' }]}>
              via {gatekeeper.contactMethod}
            </Text>
          )}
        </View>
      )}

      {/* Path steps */}
      <ScrollView
        contentContainerStyle={[
          styles.pathList,
          { paddingBottom: insets.bottom + 58 + webBottomPadding },
        ]}
      >
        {winningPath.map((step, i) => (
          <PathStepCard
            key={step.vertexId}
            step={step}
            index={i}
            total={winningPath.length}
            colors={colors}
          />
        ))}
      </ScrollView>

      {/* Generate Pitch button */}
      <View
        style={[
          styles.footer,
          {
            paddingBottom: insets.bottom + 16 + webBottomPadding,
            borderTopColor: colors.border,
            backgroundColor: colors.card,
          },
        ]}
      >
        {pitchError && (
          <Text style={[styles.pitchError, { color: colors.destructive, fontFamily: 'Inter_400Regular' }]}>
            {pitchError}
          </Text>
        )}
        <Pressable
          onPress={handleGeneratePitch}
          disabled={isGeneratingPitch}
          style={({ pressed }) => [
            styles.pitchButton,
            {
              backgroundColor: isGeneratingPitch ? colors.muted : pressed ? colors.secondary + 'CC' : colors.secondary,
              borderColor: isGeneratingPitch ? colors.border : colors.secondary,
            },
          ]}
        >
          {isGeneratingPitch ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Feather name="zap" size={16} color="#fff" />
          )}
          <Text style={[styles.pitchButtonText, { fontFamily: 'Inter_700Bold' }]}>
            {isGeneratingPitch ? 'GENERATING...' : 'GENERATE PITCH'}
          </Text>
        </Pressable>
      </View>

      {/* Pitch modal */}
      {pitchText && (
        <PitchModal
          visible={pitchVisible}
          pitch={pitchText}
          onClose={() => setPitchVisible(false)}
          colors={colors}
        />
      )}
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
  headerSub: { fontSize: 12, marginTop: 3, letterSpacing: 1 },
  scorePill: { alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, marginBottom: 2 },
  scoreText: { fontSize: 22 },
  scoreLabel: { fontSize: 8, letterSpacing: 1.5 },

  gatekeeperStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
  },
  gatekeeperText: { fontSize: 13, flex: 1 },
  gatekeeperContact: { fontSize: 12 },

  pathList: { padding: 20, gap: 0 },

  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    gap: 8,
  },
  pitchError: { fontSize: 12, paddingHorizontal: 4 },
  pitchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 6,
    borderWidth: 1,
  },
  pitchButtonText: { fontSize: 14, color: '#fff', letterSpacing: 1.5 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  emptyTitle: { fontSize: 18 },
  emptyBody: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
});

const pathStyles = StyleSheet.create({
  wrapper: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 0 },
  connector: { position: 'absolute', left: 19, top: 36, bottom: -8, width: 1.5 },
  stepCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
    flexShrink: 0,
  },
  stepNum: { fontSize: 14 },
  card: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
    marginBottom: 24,
    gap: 6,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 3,
    borderWidth: 1,
  },
  roleText: { fontSize: 9, letterSpacing: 1 },
  registry: { fontSize: 10 },
  label: { fontSize: 15 },
  nodeType: { fontSize: 11 },
  actionBox: { borderRadius: 4, borderWidth: 1, padding: 8, marginTop: 2 },
  actionText: { fontSize: 12, lineHeight: 18 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  contactText: { fontSize: 12 },
});

const pitchStyles = StyleSheet.create({
  modal: { flex: 1 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  modalTitle: { fontSize: 14, letterSpacing: 3 },
  headerActions: { flexDirection: 'row', gap: 8 },
  iconBtn: { padding: 8, borderRadius: 6, borderWidth: 1 },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    paddingHorizontal: 16,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: -1,
  },
  tabText: { fontSize: 11, letterSpacing: 0.5 },
  pitchContent: { padding: 20 },
  pitchText: { fontSize: 14, lineHeight: 24 },
  footer: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 6,
    borderWidth: 1,
  },
  shareButtonText: { fontSize: 13, color: '#fff', letterSpacing: 1.5 },
  closeButton: { paddingVertical: 12, borderRadius: 6, alignItems: 'center' },
  closeButtonText: { fontSize: 14, letterSpacing: 1 },
});
