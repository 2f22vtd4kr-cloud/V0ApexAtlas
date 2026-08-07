import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { useListEntities } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useSelection } from '@/context/SelectionContext';
import { MobileProviderStatus } from '@/components/MobileProviderStatus';

// ─── Score badge ──────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  const colors = useColors();
  const dotColor =
    score >= 0.8 ? colors.primary
    : score >= 0.6 ? colors.amber
    : score >= 0.4 ? colors.secondary
    : colors.mutedForeground;

  return (
    <View style={styles.scoreBadge}>
      <View style={[styles.scoreDot, { backgroundColor: dotColor }]} />
      <Text style={[styles.scoreText, { color: dotColor, fontFamily: 'Inter_600SemiBold' }]}>
        {(score * 100).toFixed(0)}
      </Text>
    </View>
  );
}

// ─── Format helpers ───────────────────────────────────────────────────────────

function formatNetWorth(val: number | null | undefined): string {
  if (!val) return '—';
  if (val >= 1e9) return `€${(val / 1e9).toFixed(1)}B`;
  if (val >= 1e6) return `€${(val / 1e6).toFixed(0)}M`;
  return `€${val.toLocaleString()}`;
}

const ENTITY_META: Record<string, { short: string; descriptor: string; color: string }> = {
  HNWI: { short: 'Person', descriptor: 'person and personal access profile', color: '#10B981' },
  Corporation: { short: 'Company', descriptor: 'company, holding vehicle, or operating entity', color: '#3B82F6' },
  Trust: { short: 'Trust', descriptor: 'trust, foundation, or fiduciary structure', color: '#A855F7' },
  Gatekeeper: { short: 'Access', descriptor: 'human access node or introducer', color: '#F59E0B' },
};

function entityMeta(type?: string | null) {
  return ENTITY_META[type ?? 'HNWI'] ?? ENTITY_META.HNWI;
}

function entitySignal(entity: any): string {
  const meta = entityMeta(entity.type);
  if (entity.type === 'HNWI' && entity.estimatedNetWorth != null) return formatNetWorth(entity.estimatedNetWorth);
  if (entity.type === 'Gatekeeper' && entity.contactOutcome) return entity.contactOutcome.replace(/_/g, ' ');
  if (entity.assetCount > 0) return `${entity.assetCount} linked asset${entity.assetCount === 1 ? '' : 's'}`;
  return meta.descriptor;
}

// ─── Entity card ──────────────────────────────────────────────────────────────

function EntityCard({ entity, onPress }: { entity: any; onPress: () => void }) {
  const colors = useColors();
  const meta = entityMeta(entity.type);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      {/* Left: name + meta */}
      <View style={styles.cardBody}>
        <View style={styles.cardTitleRow}>
          {entity.isHot && (
            <View style={[styles.hotDot, { backgroundColor: colors.amber }]} />
          )}
          <Text
            style={[styles.cardName, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}
            numberOfLines={1}
          >
            {entity.name}
          </Text>
        </View>

        <View style={styles.cardMeta}>
          <View style={[styles.typePill, { backgroundColor: `${meta.color}18`, borderColor: `${meta.color}55` }]}>
            <Text style={[styles.typePillText, { color: meta.color, fontFamily: 'Inter_600SemiBold' }]}>
              {meta.short}
            </Text>
          </View>
          {entity.nationality && (
            <Text style={[styles.metaItem, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {entity.nationality}
            </Text>
          )}
        </View>

        <View style={styles.cardStats}>
          <Text style={[styles.netWorth, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
            {entitySignal(entity)}
          </Text>
          {entity.assetCount > 0 && (
            <Text style={[styles.assetCount, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {entity.assetCount} asset{entity.assetCount !== 1 ? 's' : ''}
            </Text>
          )}
        </View>
      </View>

      {/* Right: score + chevron */}
      <View style={styles.cardRight}>
        <ScoreBadge score={entity.bayesianScore} />
        <Feather name="chevron-right" size={16} color={colors.mutedForeground} style={{ marginTop: 8 }} />
      </View>
    </Pressable>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TargetsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { setSelectedEntity } = useSelection();

  const { data: entities, isLoading, refetch, isRefetching } = useListEntities({ limit: 50 });

  const handleSelect = useCallback(
    (entity: any) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setSelectedEntity(entity.id, entity.name);
      router.navigate('/(tabs)/mcts');
    },
    [setSelectedEntity, router],
  );

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
        <View>
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            APEX TARGETS
          </Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {entities ? `${entities.length} entities` : 'Classified Registry'}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <MobileProviderStatus />
          <View style={[styles.headerBadge, { backgroundColor: colors.primary + '22', borderColor: colors.primary + '44' }]}>
            <Text style={[styles.headerBadgeText, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>
              LIVE
            </Text>
          </View>
        </View>
      </View>

      {/* List */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Querying registry...
          </Text>
        </View>
      ) : (
        <FlatList
          data={entities ?? []}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + 60 + webBottomPadding },
          ]}
          renderItem={({ item }) => (
            <EntityCard entity={item} onPress={() => handleSelect(item)} />
          )}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          scrollEnabled={!!(entities && entities.length > 0)}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Feather name="layers" size={32} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                No entities found.{'\n'}People, companies, trusts, and access contacts will appear here.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 13 },

  // Header
  header: {
    paddingHorizontal: 20,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, letterSpacing: 3 },
  headerSub: { fontSize: 12, marginTop: 2, letterSpacing: 0.5 },
  headerBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    marginBottom: 2,
  },
  headerBadgeText: { fontSize: 10, letterSpacing: 1.5 },

  // List
  list: { padding: 16, gap: 10 },

  // Card
  card: {
    borderRadius: 6,
    borderWidth: 1,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardBody: { flex: 1 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hotDot: { width: 6, height: 6, borderRadius: 3 },
  cardName: { fontSize: 15, flex: 1 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  typePill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, borderWidth: 1 },
  typePillText: { fontSize: 10 },
  metaItem: { fontSize: 12 },
  cardStats: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  netWorth: { fontSize: 14 },
  assetCount: { fontSize: 12 },
  cardRight: { alignItems: 'center', gap: 4 },

  // Score badge
  scoreBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  scoreDot: { width: 7, height: 7, borderRadius: 3.5 },
  scoreText: { fontSize: 13 },

  // Empty
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 12 },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
});
