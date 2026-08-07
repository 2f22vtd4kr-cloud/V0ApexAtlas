import {
  Building2,
  Landmark,
  Shield,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export type EntityType = "HNWI" | "Corporation" | "Trust" | "Gatekeeper";

type EntityLike = {
  type?: string | null;
  estimatedNetWorth?: number | null;
  assetCount?: number | null;
  relationshipCount?: number | null;
  contactOutcome?: string | null;
};

export type EntityMeta = {
  label: string;
  shortLabel: string;
  descriptor: string;
  color: string;
  Icon: LucideIcon;
  metricLabel: string;
  evidenceLabel: string;
  actionLabel: string;
};

const META: Record<EntityType, EntityMeta> = {
  HNWI: {
    label: "High-net-worth individual",
    shortLabel: "Person",
    descriptor: "person and personal access profile",
    color: "#10B981",
    Icon: UserRound,
    metricLabel: "Estimated wealth",
    evidenceLabel: "public wealth and contact evidence",
    actionLabel: "Assess access",
  },
  Corporation: {
    label: "Corporation",
    shortLabel: "Company",
    descriptor: "company, holding vehicle, or operating entity",
    color: "#3B82F6",
    Icon: Building2,
    metricLabel: "Entity signal",
    evidenceLabel: "filings, officers, and ownership evidence",
    actionLabel: "Map control",
  },
  Trust: {
    label: "Trust",
    shortLabel: "Trust",
    descriptor: "trust, foundation, or fiduciary structure",
    color: "#A855F7",
    Icon: Landmark,
    metricLabel: "Structure signal",
    evidenceLabel: "fiduciary, jurisdiction, and beneficiary evidence",
    actionLabel: "Review structure",
  },
  Gatekeeper: {
    label: "Gatekeeper",
    shortLabel: "Access",
    descriptor: "human access node or introducer",
    color: "#F59E0B",
    Icon: Shield,
    metricLabel: "Access signal",
    evidenceLabel: "role, contact, and relationship evidence",
    actionLabel: "Trace route",
  },
};

export function normalizeEntityType(type?: string | null): EntityType {
  return type === "Corporation" || type === "Trust" || type === "Gatekeeper" ? type : "HNWI";
}

export function entityMeta(type?: string | null): EntityMeta {
  return META[normalizeEntityType(type)];
}

export function entityMetric(entity: EntityLike): string {
  const type = normalizeEntityType(entity.type);
  if (type === "HNWI" && entity.estimatedNetWorth != null) return "wealth signal recorded";
  if (type === "Corporation" && (entity.relationshipCount ?? 0) > 0) {
    return `${entity.relationshipCount} control link${entity.relationshipCount === 1 ? "" : "s"}`;
  }
  if (type === "Trust" && (entity.assetCount ?? 0) > 0) {
    return `${entity.assetCount} linked asset${entity.assetCount === 1 ? "" : "s"}`;
  }
  if (type === "Gatekeeper" && entity.contactOutcome) {
    return entity.contactOutcome.replace(/_/g, " ");
  }
  return entityMeta(type).evidenceLabel;
}

export function EntityTypeMark({
  type,
  compact = false,
}: {
  type?: string | null;
  compact?: boolean;
}) {
  const meta = entityMeta(type);
  const Icon = meta.Icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded font-mono font-bold uppercase ${compact ? "px-1.5 py-0.5 text-[8px]" : "px-2 py-1 text-[9px]"}`}
      style={{ color: meta.color, backgroundColor: `${meta.color}18` }}
      title={meta.descriptor}
    >
      <Icon className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden="true" />
      {compact ? normalizeEntityType(type) : meta.shortLabel}
    </span>
  );
}

export const ENTITY_TYPES: EntityType[] = ["HNWI", "Corporation", "Trust", "Gatekeeper"];