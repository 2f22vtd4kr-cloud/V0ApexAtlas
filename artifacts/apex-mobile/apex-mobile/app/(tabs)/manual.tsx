import React, { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

// ─── Data ─────────────────────────────────────────────────────────────────────

const LEVELS = [
  {
    numeral: 'I',
    color: '#10B981',
    title: 'BASICS',
    subtitle: 'What ApexFinder does',
    icon: 'crosshair' as const,
    content: [
      {
        heading: 'The core idea',
        body: "ApexFinder is an OSINT research tool. It maps public evidence, relationships, attribution, and access signals without inferring personal identity or creating communication workflows.",
      },
      {
        heading: 'Your 5-step playbook',
        body: '1. Entity Ledger — add targets\n2. Live Intel — run registry searches\n3. Network Graph — map connections\n4. MCTS Terminal — review evidence paths\n5. Research Review — inspect attribution and access evidence',
      },
      {
        heading: 'Getting started',
        body: 'Open Entity Ledger → Add Entity → fill name, type (HNWI), nationality, net worth → Save → run Live Intel search on their name → check the Signal Score.',
      },
    ],
  },
  {
    numeral: 'II',
    color: '#3B82F6',
    title: 'DATA',
    subtitle: 'Scores & live sources',
    icon: 'database' as const,
    content: [
      {
        heading: 'Signal Score (0–100)',
        body: 'Reflects registry hits found, relationship hops to target, and warmth of those hops.\n\n● 80+ — Warm path found. Act now.\n● 60–79 — Some connections. Dig deeper.\n● <60 — Sparse data. Needs enrichment.',
      },
      {
        heading: 'OpenCorporates',
        body: "World's largest open company database. Returns corporate directorships, registered addresses, and incorporation dates. Best for finding which companies a target controls.",
      },
      {
        heading: 'SEC EDGAR',
        body: 'US SEC filings. Catches Schedule 13D/G (large share purchases >5%) and DEF 14A (proxy statements naming directors). Essential for any US-listed exposure.',
      },
      {
        heading: 'Research review stages',
        body: 'Targeted → Evidence Collected → Attribution Review → Access Assessment → Research Review.\n\nNever treat a search hit, organization route, or username as proof of personal identity or access.',
      },
    ],
  },
  {
    numeral: 'III',
    color: '#F59E0B',
    title: 'NETWORK',
    subtitle: 'Reading the graph',
    icon: 'share-2' as const,
    content: [
      {
        heading: 'Node types',
        body: 'Green — HNWI target (your subject)\nAmber — Gatekeeper (your real entry point)\nBlue — Corporation (companies they direct)\nPurple — Trust / SPV (offshore vehicles)\nGrey — Asset (yacht, aircraft, property)',
      },
      {
        heading: 'Edge types',
        body: 'OWNS — direct legal ownership\nMANAGES — director, trustee, fund manager\nMEMBER OF — shareholder, club, board seat\nKNOWN ASSOCIATE — co-investor, social tie',
      },
      {
        heading: 'Strategy',
        body: '1. Select your target in the dropdown\n2. Review amber intermediary nodes as evidence only\n3. Check each relationship against its source\n4. Separate wealth and signal from access\n5. Run MCTS to get a ranked, reviewable evidence path',
      },
    ],
  },
  {
    numeral: 'IV',
    color: '#EF4444',
    title: 'ENGINE',
    subtitle: 'How the algorithms work',
    icon: 'cpu' as const,
    content: [
      {
        heading: 'Bayesian Signal Score',
        body: 'Uses log-odds updates. Each registry hit, relationship hop, and contact type shifts the score. Personal phone/WhatsApp > family office access > company address. More evidence → higher confidence.',
      },
      {
        heading: 'MCTS (Monte Carlo Tree Search)',
        body: 'Simulates thousands of approach paths from your position to the target. Uses UCT formula to balance exploration vs exploitation. Returns the path with the highest expected warmth — weighted toward personal contact channels.',
      },
      {
        heading: '"Get close to the body"',
        body: "The engine weights paths that lead to PERSONAL contact with the HNWI — personal WhatsApp, direct phone, private introduction. Company secretary's email = near-zero score. Private banker's personal mobile = near-100.",
      },
    ],
  },
];

// ─── Components ───────────────────────────────────────────────────────────────

function LevelCard({
  level,
  expanded,
  onToggle,
  colors,
}: {
  level: typeof LEVELS[0];
  expanded: boolean;
  onToggle: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Card header */}
      <TouchableOpacity
        onPress={onToggle}
        activeOpacity={0.7}
        style={styles.cardHeader}
      >
        <View style={[styles.levelBadge, { backgroundColor: level.color + '20', borderColor: level.color + '50' }]}>
          <Text style={[styles.levelNumeral, { color: level.color, fontFamily: 'Inter_700Bold' }]}>
            {level.numeral}
          </Text>
        </View>
        <View style={styles.cardTitleGroup}>
          <Text style={[styles.cardTitle, { color: level.color, fontFamily: 'Inter_700Bold' }]}>
            {level.title}
          </Text>
          <Text style={[styles.cardSubtitle, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {level.subtitle}
          </Text>
        </View>
        <Feather
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.mutedForeground}
        />
      </TouchableOpacity>

      {/* Expanded content */}
      {expanded && (
        <View style={[styles.cardBody, { borderTopColor: colors.border }]}>
          {level.content.map((section, i) => (
            <View
              key={i}
              style={[
                styles.section,
                i < level.content.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: 1 },
              ]}
            >
              <View style={styles.sectionHeadingRow}>
                <View style={[styles.sectionDot, { backgroundColor: level.color }]} />
                <Text style={[styles.sectionHeading, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                  {section.heading}
                </Text>
              </View>
              <Text style={[styles.sectionBody, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                {section.body}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function FieldManualScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [expandedLevel, setExpandedLevel] = useState<number>(0); // 0 = first open

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 12,
            borderBottomColor: colors.border,
            backgroundColor: colors.card,
          },
        ]}
      >
        <View style={styles.headerIcon}>
          <Feather name="book-open" size={16} color="#10B981" />
        </View>
        <View>
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            FIELD MANUAL
          </Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Read top to bottom
          </Text>
        </View>
      </View>

      {/* Content */}
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 80 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Intro */}
        <View style={[styles.intro, { backgroundColor: '#10B98111', borderColor: '#10B98130' }]}>
          <Feather name="crosshair" size={14} color="#10B981" style={{ marginBottom: 6 }} />
          <Text style={[styles.introText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            ApexFinder Pro is a private intelligence platform. Load a roster of ultra-high-net-worth individuals, enrich their profiles from public registries, map their connections, and let the engine find the warmest path to reach them.
          </Text>
        </View>

        {/* Level cards */}
        {LEVELS.map((level, i) => (
          <LevelCard
            key={level.numeral}
            level={level}
            expanded={expandedLevel === i}
            onToggle={() => setExpandedLevel(expandedLevel === i ? -1 : i)}
            colors={colors}
          />
        ))}

        {/* Footer note */}
        <Text style={[styles.footer, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          v0.2 · Private Build · ApexFinder Pro
        </Text>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 14,
    gap: 12,
    borderBottomWidth: 1,
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#10B98115',
    borderWidth: 1,
    borderColor: '#10B98130',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, letterSpacing: 3 },
  headerSub: { fontSize: 11, marginTop: 2, letterSpacing: 0.5 },

  scrollContent: {
    padding: 16,
    gap: 12,
  },

  intro: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 16,
    marginBottom: 4,
  },
  introText: { fontSize: 13, lineHeight: 20 },

  card: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
  },
  levelBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  levelNumeral: { fontSize: 15 },
  cardTitleGroup: { flex: 1 },
  cardTitle: { fontSize: 13, letterSpacing: 2 },
  cardSubtitle: { fontSize: 11, marginTop: 2 },

  cardBody: {
    borderTopWidth: 1,
  },
  section: {
    padding: 16,
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  sectionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  sectionHeading: { fontSize: 13 },
  sectionBody: { fontSize: 12, lineHeight: 20 },

  footer: {
    textAlign: 'center',
    fontSize: 10,
    letterSpacing: 1,
    marginTop: 8,
    opacity: 0.4,
  },
});
