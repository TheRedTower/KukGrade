import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  type AgeBandEnum,
  type EffectiveSyllabusRequirement,
  type Programme,
  getAllEffectiveSyllabusRequirements,
} from "./api";
import { BeltSwatch } from "./Belt";
import { useAgeBandsQuery, useRanksQuery } from "./queries";
import { ResponsiveTable } from "./ResponsiveTable";
import { ScrollRail } from "./ScrollRail";
import "./Syllabus.css";

function provenance(row: EffectiveSyllabusRequirement): { isNew: boolean; text: string } {
  if (row.is_new_at_rank) {
    return { isNew: true, text: `New at ${row.effective_since_rank_name}` };
  }
  if (row.introduced_rank_code === row.effective_since_rank_code) {
    return { isNew: false, text: `From ${row.introduced_rank_name}` };
  }
  return {
    isNew: false,
    text: `From ${row.introduced_rank_name}, extended at ${row.effective_since_rank_name}`,
  };
}

interface Ledger {
  category: string;
  title: string;
  rows: EffectiveSyllabusRequirement[];
}

// One ledger per category - Techniques, Forms, Weapons - in the order served.
function ledgersByCategory(rows: EffectiveSyllabusRequirement[]): Ledger[] {
  const ledgers = new Map<string, Ledger>();
  for (const row of rows) {
    const ledger = ledgers.get(row.category);
    if (ledger) {
      ledger.rows.push(row);
    } else {
      ledgers.set(row.category, {
        category: row.category,
        title: row.category_display,
        rows: [row],
      });
    }
  }
  return [...ledgers.values()];
}

function SyllabusLedgerTable({
  title,
  rows,
}: {
  title: string;
  rows: EffectiveSyllabusRequirement[];
}) {
  return (
    <ResponsiveTable
      label={`${title} for this rank`}
      rows={rows}
      rowKey={(row) => row.item_code}
      columns={[
        {
          key: "curriculum",
          header: "Curriculum",
          primary: true,
          render: (row) => {
            const { isNew } = provenance(row);
            const rangeDisplay = row.display_range || row.notation || "—";
            const noteText = !row.notation && row.notes && row.notes !== rangeDisplay ? row.notes : "";
            return (
              <div className="syl-cell-curriculum">
                <div className="syl-item-name">
                  {row.item_name}
                  {isNew && <span className="syl-new-badge">NEW</span>}
                </div>
                {row.item_korean_name && <div className="syl-item-korean">{row.item_korean_name}</div>}
                {noteText && <div className="syl-item-notes">{noteText}</div>}
              </div>
            );
          },
        },
        {
          key: "range",
          header: "Range",
          render: (row) => <span className="syl-range-value">{row.display_range || row.notation || "—"}</span>,
        },
        { key: "since", header: "Since", render: (row) => <span className="syl-cell-provenance">{provenance(row).text}</span> },
        {
          key: "requirement",
          header: "Requirement",
          align: "end",
          render: (row) =>
            row.required ? (
              <span className="syl-badge-required">Required</span>
            ) : (
              <span className="syl-badge-optional">Optional</span>
            ),
        },
      ]}
    />
  );
}

export function SyllabusScreen() {
  const ranksQuery = useRanksQuery();
  const ageBandsQuery = useAgeBandsQuery();
  // Only the ranks whose syllabus is recorded; the server says which.
  const ranks = useMemo(
    () => (ranksQuery.data?.results ?? []).filter((rank) => rank.has_syllabus),
    [ranksQuery.data],
  );
  const ageBands = useMemo(() => ageBandsQuery.data?.results ?? [], [ageBandsQuery.data]);

  // Until the viewer picks, the screen opens on the first rank that has a
  // syllabus of its own (Yellow, or the first served rank if Yellow is
  // absent) and the first age band the server lists.
  const [chosenRankCode, setChosenRankCode] = useState<string | null>(null);
  const [chosenAgeBand, setChosenAgeBand] = useState<AgeBandEnum | null>(null);
  const selectedRankCode =
    chosenRankCode ??
    (ranks.some((r) => r.code === "YELLOW") ? "YELLOW" : (ranks[0]?.code ?? ""));
  const selectedAgeBand = chosenAgeBand ?? ageBands[0]?.code ?? null;
  const programme: Programme =
    ageBands.find((band) => band.code === selectedAgeBand)?.programme ?? "JUNIOR";

  // Everything a grading for this rank and age band assesses, in syllabus
  // order - the same rows assessment generation snapshots.
  const requirementsQuery = useQuery({
    queryKey: ["effectiveSyllabus", selectedRankCode, selectedAgeBand],
    queryFn: () =>
      getAllEffectiveSyllabusRequirements({
        rank_code: selectedRankCode,
        age_band: selectedAgeBand!,
      }),
    enabled: !!selectedRankCode && selectedAgeBand !== null,
  });
  const requirements = useMemo(
    () => requirementsQuery.data?.results ?? [],
    [requirementsQuery.data],
  );
  const isLoading =
    ranksQuery.isLoading || ageBandsQuery.isLoading || requirementsQuery.isLoading;

  const loadError = ranksQuery.error ?? ageBandsQuery.error ?? requirementsQuery.error;
  const error = loadError
    ? loadError instanceof Error
      ? loadError.message
      : "Failed to load the syllabus."
    : null;

  // A programme change keeps the age band if it belongs to that programme,
  // otherwise moves to the programme's oldest band.
  function handleProgrammeChange(newProgramme: Programme) {
    const bands = ageBands.filter((band) => band.programme === newProgramme);
    if (bands.length > 0 && !bands.some((band) => band.code === selectedAgeBand)) {
      setChosenAgeBand(bands[bands.length - 1].code);
    }
  }

  function handleAgeBandChange(newAgeBand: AgeBandEnum) {
    setChosenAgeBand(newAgeBand);
  }

  const selectedRank = ranks.find((r) => r.code === selectedRankCode) ?? null;
  const nextRank = ranks.find((r) => r.id === selectedRank?.next_rank) ?? null;

  const currentAgeBand = ageBands.find((band) => band.code === selectedAgeBand);
  const programmes = ageBands.filter(
    (band, index) => ageBands.findIndex((other) => other.programme === band.programme) === index,
  );

  const rankName = selectedRank ? selectedRank.name : selectedRankCode;
  // Which categories are core areas is served with each row.
  const coreAreas = requirements.filter((row) => row.category_is_core);
  const ledgers = ledgersByCategory(requirements.filter((row) => !row.category_is_core));
  // A rank with no syllabus of its own gets nothing back, rather than the
  // earlier ranks' content presented as its whole curriculum.
  const hasNoSyllabus = requirementsQuery.isSuccess && requirements.length === 0;

  return (
    <section aria-labelledby="syllabus-heading" className="page syl-container">
      {/* Header */}
      <div className="section-header syl-header">
        <div>
          <h1 id="syllabus-heading">Syllabus</h1>
          <p className="section-subtitle">Teaching and grading requirements</p>
        </div>
      </div>

      {/* Top Filter Controls */}
      <div className="filter-bar syl-filter-bar" aria-label="Syllabus filters">
        <div className="field">
          <label htmlFor="syl-curriculum-select">Curriculum</label>
          <select
            id="syl-curriculum-select"
            value={programme}
            onChange={(e) => handleProgrammeChange(e.target.value as Programme)}
          >
            {programmes.map((band) => (
              <option key={band.programme} value={band.programme}>
                {band.programme_display}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="syl-age-select">Age group</label>
          <select
            id="syl-age-select"
            value={selectedAgeBand ?? ""}
            onChange={(e) => handleAgeBandChange(e.target.value as AgeBandEnum)}
          >
            {ageBands.map((band) => (
              <option key={band.code} value={band.code}>
                {band.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="syl-rank-select">Testing for</label>
          <select
            id="syl-rank-select"
            value={selectedRankCode}
            onChange={(e) => setChosenRankCode(e.target.value)}
            disabled={ranksQuery.isLoading || ranks.length === 0}
          >
            {ranks.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* The ranks: a page at a time, so every one is shown whole. */}
      <ScrollRail label="Ranks" watch={selectedRankCode} className="syl-belt-rail">
        {ranks.map((rank) => {
          const isSelected = rank.code === selectedRankCode;
          return (
            <button
              key={rank.code}
              type="button"
              className={`syl-belt-btn ${isSelected ? "syl-belt-btn-active" : ""}`}
              onClick={() => setChosenRankCode(rank.code)}
              aria-pressed={isSelected}
              title={`Select ${rank.name}`}
            >
              <BeltSwatch rank={rank} />
              <span className="syl-belt-label">{rank.name}</span>
            </button>
          );
        })}
      </ScrollRail>

      {/* Main Rank Chapter View */}
      <div className="syl-rank-content">
        {/* Rank Chapter Heading */}
        <div className="syl-rank-header">
          <div>
            <h2 className="syl-rank-title">{rankName}</h2>
            <p className="syl-rank-subtitle">
              {currentAgeBand?.description || "Curriculum requirements"}
            </p>
            {requirements.length > 0 && (
              <p className="syl-rank-everything-note">
                Everything examinable through {rankName}, all assessed at every grading.
              </p>
            )}
          </div>

          {nextRank && (
            <button
              type="button"
              className="syl-next-rank-btn"
              onClick={() => setChosenRankCode(nextRank.code)}
            >
              Next rank: {nextRank.name} →
            </button>
          )}
        </div>

        {/* Error State */}
        {error && (
          <div className="error-banner" role="alert">
            <span className="error-icon" aria-hidden="true">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {isLoading ? (
          <div className="syl-loading-state" aria-live="polite">
            <span className="syl-spinner" aria-hidden="true" />
            <span>Loading curriculum requirements…</span>
          </div>
        ) : hasNoSyllabus ? (
          <div className="syl-empty-state">
            <p>
              No syllabus is recorded for {rankName} in this age group yet, so nobody can be
              assessed for it.
            </p>
          </div>
        ) : (
          <>
            {coreAreas.length > 0 && (
              <div className="syl-section-block">
                <div className="syl-section-title-wrap">
                  <h3 className="syl-section-title">Core grading areas</h3>
                  <p className="syl-section-subtitle">The same areas at every rank.</p>
                </div>
                <div className="syl-core-grid">
                  {coreAreas.map((area) => (
                    <div key={area.item_code} className="syl-core-card">
                      <div className="syl-core-name">{area.item_name}</div>
                      {area.item_korean_name && (
                        <div className="syl-core-korean">{area.item_korean_name}</div>
                      )}
                      <div className="syl-core-english">{area.category_display}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {ledgers.map((ledger) => (
              <div key={ledger.category} className="syl-section-block">
                <div className="syl-section-title-wrap">
                  <h3 className="syl-section-title">{ledger.title}</h3>
                  <p className="syl-section-subtitle">
                    Where a later rank extended an item, its latest range is shown.
                  </p>
                </div>
                <SyllabusLedgerTable title={ledger.title} rows={ledger.rows} />
              </div>
            ))}
          </>
        )}
      </div>

      {/* Footer Reference */}
      <footer className="syl-footer">
        <div className="syl-footer-brand">
          <strong>KukGrade</strong>
          <span className="syl-footer-divider">|</span>
          <span>Past assessments keep the wording they were graded on.</span>
        </div>
        <div className="syl-footer-reference">
          Preliminary reference: WKSA curriculum chart, 2014
        </div>
      </footer>
    </section>
  );
}
