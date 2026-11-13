import { useMemo, useState } from "react";
import { PageHeader } from "./PageHeader";
import { useQuery } from "@tanstack/react-query";
import {
  type AgeBandEnum,
  type EffectiveSyllabusRequirement,
  type Programme,
  errorMessage,
  getAllEffectiveSyllabusRequirements,
} from "./api";
import { Alert } from "./Alert";
import { EmptyState } from "./EmptyState";
import { LoadingState } from "./LoadingState";
import { BeltSwatch } from "./Belt";
import { Button } from "./Button";
import { useAgeBandsQuery, useRanksQuery } from "./queries";
import { Badge } from "./Badge";
import { ResponsiveTable } from "./ResponsiveTable";
import { ScrollRail } from "./ScrollRail";
import { RequirementBadge } from "./StatusBadge";
import "./Syllabus.css";
import { keys } from "./queryKeys";
import { ArrowRightIcon } from "./Icons";
import { Field } from "./Field";
import { Select } from "./Select";

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

function SyllabusLedgerTable({ title, rows }: { title: string; rows: EffectiveSyllabusRequirement[] }) {
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
                <div className="row row--wrap item-title">
                  {row.item_name}
                  {isNew && <Badge tone="info">NEW</Badge>}
                </div>
                {row.item_korean_name && (
                  <div className="meta" lang="ko">
                    {row.item_korean_name}
                  </div>
                )}
                {noteText && <div className="syl-item-notes meta">{noteText}</div>}
              </div>
            );
          },
        },
        {
          key: "range",
          header: "Range",
          render: (row) => (
            <span className="syl-range-value item-title">{row.display_range || row.notation || "—"}</span>
          ),
        },
        { key: "since", header: "Since", render: (row) => <span className="subtext">{provenance(row).text}</span> },
        {
          key: "requirement",
          header: "Requirement",
          align: "end",
          render: (row) => <RequirementBadge required={row.required} />,
        },
      ]}
    />
  );
}

export function SyllabusScreen() {
  const ranksQuery = useRanksQuery();
  const ageBandsQuery = useAgeBandsQuery();
  // Only the ranks whose syllabus is recorded; the server says which.
  const ranks = useMemo(() => (ranksQuery.data?.results ?? []).filter((rank) => rank.has_syllabus), [ranksQuery.data]);
  const ageBands = useMemo(() => ageBandsQuery.data?.results ?? [], [ageBandsQuery.data]);

  // Until the viewer picks, the screen opens on the first served rank that
  // has a syllabus of its own and the first age band the server lists.
  const [chosenRankCode, setChosenRankCode] = useState<string | null>(null);
  const [chosenAgeBand, setChosenAgeBand] = useState<AgeBandEnum | null>(null);
  const selectedRankCode = chosenRankCode ?? ranks[0]?.code ?? "";
  const selectedAgeBand = chosenAgeBand ?? ageBands[0]?.code ?? null;
  const programme = ageBands.find((band) => band.code === selectedAgeBand)?.programme;

  // Everything a grading for this rank and age band assesses, in syllabus
  // order - the same rows assessment generation snapshots.
  const requirementsQuery = useQuery({
    queryKey: keys.effectiveSyllabus(selectedRankCode, selectedAgeBand),
    queryFn: () =>
      getAllEffectiveSyllabusRequirements({
        rank_code: selectedRankCode,
        age_band: selectedAgeBand!,
      }),
    enabled: !!selectedRankCode && selectedAgeBand !== null,
  });
  const requirements = useMemo(() => requirementsQuery.data?.results ?? [], [requirementsQuery.data]);
  const isLoading = ranksQuery.isLoading || ageBandsQuery.isLoading || requirementsQuery.isLoading;

  const loadError = ranksQuery.error ?? ageBandsQuery.error ?? requirementsQuery.error;
  const error = loadError ? errorMessage(loadError, "The syllabus could not be loaded.") : null;

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
    <section aria-labelledby="syllabus-heading" className="page">
      <PageHeader title="Syllabus" titleId="syllabus-heading" subtitle="Teaching and grading requirements" />

      {/* Top Filter Controls */}
      <div className="filter-bar" aria-label="Syllabus filters">
        <Field label="Curriculum" look="label">
          {(control) => (
            <Select
              {...control}
              options={programmes.map((band) => ({ value: band.programme, label: band.programme_display }))}
              value={programme ?? ""}
              onChange={(value) => handleProgrammeChange(value as Programme)}
            />
          )}
        </Field>

        <Field label="Age group" look="label">
          {(control) => (
            <Select
              {...control}
              options={ageBands.map((band) => ({ value: band.code, label: band.name }))}
              value={selectedAgeBand ?? ""}
              onChange={(value) => handleAgeBandChange(value as AgeBandEnum)}
            />
          )}
        </Field>

        <Field label="Testing for" look="label">
          {(control) => (
            <Select
              {...control}
              options={ranks.map((r) => ({ value: r.code, label: r.name }))}
              value={selectedRankCode}
              onChange={setChosenRankCode}
              disabled={ranksQuery.isLoading || ranks.length === 0}
            />
          )}
        </Field>
      </div>

      {/* The ranks: a page at a time, so every one is shown whole. */}
      <ScrollRail label="Ranks" watch={selectedRankCode}>
        {ranks.map((rank) => {
          const isSelected = rank.code === selectedRankCode;
          return (
            <Button
              key={rank.code}
              className="syl-belt"
              onClick={() => setChosenRankCode(rank.code)}
              aria-pressed={isSelected}
              title={`Select ${rank.name}`}
            >
              <BeltSwatch rank={rank} />
              <span className="syl-belt-label">{rank.name}</span>
            </Button>
          );
        })}
      </ScrollRail>

      {/* Main Rank Chapter View */}
      <div className="stack stack--6">
        {/* Rank Chapter Heading */}
        <div className="syl-rank-header">
          <div>
            <h2 className="syl-rank-title">{rankName}</h2>
            <p className="syl-rank-subtitle subtext">{currentAgeBand?.description || "Curriculum requirements"}</p>
            {requirements.length > 0 && (
              <p className="syl-rank-everything-note subtext">
                Everything examinable through {rankName}, all assessed at every grading.
              </p>
            )}
          </div>

          {nextRank && (
            <Button variant="link" onClick={() => setChosenRankCode(nextRank.code)}>
              Next rank: {nextRank.name} <ArrowRightIcon />
            </Button>
          )}
        </div>

        {/* Error State */}
        {error && <Alert>{error}</Alert>}

        {isLoading ? (
          <LoadingState>Loading curriculum requirements…</LoadingState>
        ) : hasNoSyllabus ? (
          <EmptyState framed>
            No syllabus is recorded for {rankName} in this age group yet, so nobody can be assessed for it.
          </EmptyState>
        ) : (
          <>
            {coreAreas.length > 0 && (
              <div className="stack stack--4">
                <div className="stack stack--1">
                  <h3 className="section-title">Core grading areas</h3>
                  <p className="syl-section-subtitle subtext">The same areas at every rank.</p>
                </div>
                <div className="even-set">
                  <div className="syl-core-grid tiles tiles--narrowest even-set__items">
                    {coreAreas.map((area) => (
                      <div key={area.item_code} className="syl-core-card">
                        <div className="item-title">{area.item_name}</div>
                        {area.item_korean_name && (
                          <div className="subtext" lang="ko">
                            {area.item_korean_name}
                          </div>
                        )}
                        <div className="syl-core-english meta">{area.category_display}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {ledgers.map((ledger) => (
              <div key={ledger.category} className="stack stack--4">
                <div className="stack stack--1">
                  <h3 className="section-title">{ledger.title}</h3>
                  <p className="syl-section-subtitle subtext">
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
      <footer className="syl-footer subtext">
        <div className="row syl-footer-brand">
          <strong>KukGrade</strong>
          <span className="syl-footer-divider">|</span>
          <span>Past assessments keep the wording they were graded on.</span>
        </div>
        <div className="meta">Preliminary reference: WKSA curriculum chart, 2014</div>
      </footer>
    </section>
  );
}
