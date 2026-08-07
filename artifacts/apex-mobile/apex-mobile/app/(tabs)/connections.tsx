import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useSelection } from '@/context/SelectionContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Relationship {
  id: number;
  sourceEntityId: number;
  targetId: number;
  targetType: 'Entity' | 'Asset';
  targetName: string | null;
  relationshipType: string;
  strength: number | null;
  notes: string | null;
}

// ─── Connection card ──────────────────────────────────────────────────────────

function ConnectionCard({ rel, colors }: { rel: Relationship; colors: ReturnType<typeof useColors> }) {
  const strength = (rel.strength ?? 0.5) * 100;
  const strengthCls = strength >= 70 ? colors.primary : strength >= 40 ? colors.amber : colors.mutedForeground;

  return (
    <View style={[cardStyles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={cardStyles.header}>
        <View style={[cardStyles.typePill, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '30' }]}>
          <Text style={[cardStyles.typeText, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>
            {rel.targetType.toUpperCase()}
          </Text>
        </View>
        <View style={[cardStyles.relPill, { backgroundColor: colors.secondary + '18', borderColor: colors.secondary + '30' }]}>
          <Text style={[cardStyles.relText, { color: colors.secondary, fontFamily: 'Inter_500Medium' }]}>
            {rel.relationshipType.replace(/_/g, ' ')}
          </Text>
        </View>
        <Text style={[cardStyles.strength, { color: strengthCls, fontFamily: 'Inter_700Bold' }]}>
          {strength.toFixed(0)}%
        </Text>
      </View>

      <Text style={[cardStyles.name, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]} numberOfLines={1}>
        {rel.targetName ?? `#${rel.targetId}`}
      </Text>

      {rel.notes ? (
        <Text style={[cardStyles.notes, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]} numberOfLines={2}>
          {rel.notes}
        </Text>
      ) : null}
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginVertical: 6,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  typePill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, borderWidth: 1 },
  typeText: { fontSize: 9, letterSpacing: 1.5 },
  relPill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, borderWidth: 1 },
  relText: { fontSize: 10 },
  strength: { marginLeft: 'auto', fontSize: 11 },
  name: { fontSize: 15 },
  notes: { fontSize: 12, lineHeight: 18 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ConnectionsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { selectedEntityId, selectedEntityName } = useSelection();

  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedEntityId) { setRelationships([]); return; }
    setLoading(true);
    setError(null);
    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    if (!domain) { setLoading(false); return; }
    fetch(`https://${domain}/api/relationships?entityId=${selectedEntityId}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data: Relationship[]) => { setRelationships(data); setLoading(false); })
      .catch((err: any) => { setError(err.message ?? 'Failed to load'); setLoading(false); });
  }, [selectedEntityId]);

  const hasTarget = !!selectedEntityId;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border, paddingTop: insets.top + 12 }]}>
        <Feather name="share-2" size={16} color={colors.primary} />
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>
            CONNECTIONS
          </Text>
          {hasTarget && (
            <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]} numberOfLines={1}>
              {selectedEntityName ?? `Entity #${selectedEntityId}`}
            </Text>
          )}
        </View>
        <View style={[styles.countBadge, { backgroundColor: colors.primary + '18', borderColor: colors.primary + '30' }]}>
          <Text style={[styles.countText, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>
            {relationships.length}
          </Text>
        </View>
      </View>

      {/* Body */}
      {!hasTarget ? (
        <View style={styles.center}>
          <Feather name="target" size={40} color={colors.mutedForeground + '40'} />
          <Text style={[styles.emptyTitle, { color: colors.mutedForeground, fontFamily: 'Inter_700Bold' }]}>
            No target selected
          </Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Select an entity in the Targets tab to see its connections.
          </Text>
        </View>
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={32} color={colors.destructive} />
          <Text style={[styles.emptyTitle, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>{error}</Text>
        </View>
      ) : relationships.length === 0 ? (
        <View style={styles.center}>
          <Feather name="share-2" size={40} color={colors.mutedForeground + '40'} />
          <Text style={[styles.emptyTitle, { color: colors.mutedForeground, fontFamily: 'Inter_700Bold' }]}>
            No connections
          </Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Add connections from the web app profile, or run Auto-detect from Data Sources.
          </Text>
        </View>
      ) : (
        <FlatList
          data={relationships}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <ConnectionCard rel={item} colors={colors} />}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.bottom + 24 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerText: { flex: 1 },
  title: { fontSize: 12, letterSpacing: 2 },
  subtitle: { fontSize: 12, marginTop: 1 },
  countBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  countText: { fontSize: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  emptyTitle: { fontSize: 15, textAlign: 'center' },
  emptyBody: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
});
