import { useEffect, useRef, useState } from "react";
import {
  type AgeBandEnum,
  type EffectiveSyllabusRequirement,
  type Rank,
  type SyllabusItem,
  getAllEffectiveSyllabusRequirements,
  getRanks,
  getSyllabusItems,
} from "./api";
import "./Syllabus.css";
import { CORE_CATEGORY_CODES } from "./syllabusCategories";

type CurriculumTrack = "JUNIOR_LITTLE_DRAGON" | "ADULT_YOUTH";

interface AgeBandOption {
  value: AgeBandEnum;
  label: string;
  shortLabel: string;
  track: CurriculumTrack;
  ageDisplay: string;
}

const AGE_BAND_OPTIONS: AgeBandOption[] = [
  {
    value: "AGE_8_AND_UNDER",
    label: "8 and under",
    shortLabel: "≤ 8",
    track: "JUNIOR_LITTLE_DRAGON",
    ageDisplay: "Little Dragon ages 8 and under",
  },
  {
    value: "AGE_9_TO_12",
    label: "9 – 12",
    shortLabel: "9 – 12",
    track: "JUNIOR_LITTLE_DRAGON",
    ageDisplay: "Junior ages 9 – 12",
  },
  {
    value: "AGE_13_TO_17",
    label: "13 – 17",
    shortLabel: "13 – 17",
    track: "ADULT_YOUTH",
    ageDisplay: "Youth ages 13 – 17",
  },
  {
    value: "AGE_18_AND_OVER",
    label: "18+",
    shortLabel: "18+",
    track: "ADULT_YOUTH",
    ageDisplay: "Adult ages 18+",
  },
];

export function BeltSwatch({ rankCode, rankName }: { rankCode: string; rankName: string }) {
  const code = rankCode.toUpperCase();
  const name = rankName.toLowerCase();

  // White
  if (code === "WHITE" || name === "white") {
    return <span className="syl-swatch syl-swatch-white" aria-hidden="true" />;
  }

  // Yellow Stripe
  if (code === "YELLOW_STRIPE" || (name.includes("yellow") && name.includes("stripe"))) {
    return (
      <span className="syl-swatch syl-swatch-yellow-stripe" aria-hidden="true">
        <span className="syl-swatch-stripe" />
      </span>
    );
  }

  // Yellow
  if (code === "YELLOW" || name.includes("yellow")) {
    return <span className="syl-swatch syl-swatch-yellow" aria-hidden="true" />;
  }

  // Blue Stripe
  if (code === "BLUE_STRIPE" || (name.includes("blue") && name.includes("stripe"))) {
    return (
      <span className="syl-swatch syl-swatch-blue-stripe" aria-hidden="true">
        <span className="syl-swatch-stripe" />
      </span>
    );
  }

  // Blue
  if (code === "BLUE" || name.includes("blue")) {
    return <span className="syl-swatch syl-swatch-blue" aria-hidden="true" />;
  }

  // Red Stripe
  if (code === "RED_STRIPE" || (name.includes("red") && name.includes("stripe"))) {
    return (
      <span className="syl-swatch syl-swatch-red-stripe" aria-hidden="true">
        <span className="syl-swatch-stripe" />
      </span>
    );
  }

  // Red
  if (code === "RED" || name.includes("red")) {
    return <span className="syl-swatch syl-swatch-red" aria-hidden="true" />;
  }

  // Brown Stripe
  if (code === "BROWN_STRIPE" || (name.includes("brown") && name.includes("stripe"))) {
    return (
      <span className="syl-swatch syl-swatch-brown-stripe" aria-hidden="true">
        <span className="syl-swatch-stripe" />
      </span>
    );
  }

  // Brown
  if (code === "BROWN" || name.includes("brown")) {
    return <span className="syl-swatch syl-swatch-brown" aria-hidden="true" />;
  }

  // Black Stripe
  if (code === "BLACK_STRIPE" || (name.includes("black") && name.includes("stripe"))) {
    return (
      <span className="syl-swatch syl-swatch-black-stripe" aria-hidden="true">
        <span className="syl-swatch-stripe" />
      </span>
    );
  }

  // Dahn Bo / Dahn Bo Nim
  if (code === "DAHN_BO" || name.includes("dahn")) {
    return (
      <span className="syl-swatch syl-swatch-dahn-bo" aria-hidden="true">
        <span className="syl-swatch-stripe syl-swatch-stripe-gold" />
      </span>
    );
  }

  // Black belt / Master ranks (JKN, KSN, PSBN, SBN, PKJN)
  return <span className="syl-swatch syl-swatch-black" aria-hidden="true" />;
}

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

function SyllabusLedgerTable({
  title,
  rows,
}: {
  title: string;
  rows: EffectiveSyllabusRequirement[];
}) {
  if (rows.length === 0) {
    return (
      <div className="syl-empty-state">
        <p>No {title.toLowerCase()} are listed for this rank in the current syllabus.</p>
      </div>
    );
  }

  return (
    <div className="syl-table-wrapper">
      <table className="syl-table" aria-label={`${title} for this rank`}>
        <thead>
          <tr>
            <th scope="col" style={{ width: "40%" }}>
              Curriculum
            </th>
            <th scope="col" style={{ width: "15%" }}>
              Range
            </th>
            <th scope="col" style={{ width: "30%" }}>
              Provenance
            </th>
            <th scope="col" style={{ width: "15%", textAlign: "right" }}>
              Requirement
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { isNew, text: provenanceText } = provenance(row);
            const rangeDisplay = row.display_range || row.notation || "—";
            const noteText =
              !row.notation && row.notes && row.notes !== rangeDisplay ? row.notes : "";

            return (
              <tr key={row.item_code}>
                <td className="syl-cell-curriculum">
                  <div className="syl-item-name">
                    {row.item_name}
                    {isNew && <span className="syl-new-badge">NEW</span>}
                  </div>
                  {row.item_korean_name && (
                    <div className="syl-item-korean">{row.item_korean_name}</div>
                  )}
                  {noteText && <div className="syl-item-notes">{noteText}</div>}
                </td>
                <td className="syl-cell-range">
                  <span className="syl-range-value">{rangeDisplay}</span>
                </td>
                <td className="syl-cell-provenance">{provenanceText}</td>
                <td className="syl-cell-requirement" style={{ textAlign: "right" }}>
                  {row.required ? (
                    <span className="syl-badge-required">Required</span>
                  ) : (
                    <span className="syl-badge-optional">Optional</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SyllabusScreen() {
  const [ranks, setRanks] = useState<Rank[]>([]);
  const [selectedRankCode, setSelectedRankCode] = useState<string>("YELLOW");
  const [curriculumTrack, setCurriculumTrack] =
    useState<CurriculumTrack>("JUNIOR_LITTLE_DRAGON");
  const [selectedAgeBand, setSelectedAgeBand] =
    useState<AgeBandEnum>("AGE_9_TO_12");

  const [coreAreas, setCoreAreas] = useState<SyllabusItem[]>([]);
  const [effectiveRequirements, setEffectiveRequirements] = useState<
    EffectiveSyllabusRequirement[]
  >([]);
  const [isLoadingRanks, setIsLoadingRanks] = useState(true);
  const [isLoadingCoreAreas, setIsLoadingCoreAreas] = useState(true);
  const [isLoadingRequirements, setIsLoadingRequirements] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const beltTrackRef = useRef<HTMLDivElement>(null);

  // Load ranks once on mount
  useEffect(() => {
    let active = true;
    async function fetchRanks() {
      try {
        setIsLoadingRanks(true);
        setError(null);
        const res = await getRanks({ page_size: 100 });
        if (!active) return;
        const fetchedRanks = res.results || [];
        setRanks(fetchedRanks);

        // If YELLOW exists in ranks, default to it, otherwise default to first rank
        if (fetchedRanks.length > 0) {
          const hasYellow = fetchedRanks.some((r) => r.code === "YELLOW");
          if (!hasYellow) {
            setSelectedRankCode(fetchedRanks[0].code);
          }
        }
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : "Failed to load rank catalogue.",
        );
      } finally {
        if (active) {
          setIsLoadingRanks(false);
        }
      }
    }

    void fetchRanks();
    return () => {
      active = false;
    };
  }, []);

  // Load the universal core grading areas once - they are not rank-specific.
  useEffect(() => {
    let active = true;
    async function fetchCoreAreas() {
      try {
        setIsLoadingCoreAreas(true);
        const res = await getSyllabusItems({ page_size: 100 });
        if (!active) return;
        setCoreAreas((res.results || []).filter((item) => CORE_CATEGORY_CODES.has(item.category)));
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : "Failed to load core grading areas.",
        );
      } finally {
        if (active) {
          setIsLoadingCoreAreas(false);
        }
      }
    }

    void fetchCoreAreas();
    return () => {
      active = false;
    };
  }, []);

  // Load cumulative effective requirements whenever rank or age band changes
  useEffect(() => {
    let active = true;
    async function fetchEffectiveRequirements() {
      if (!selectedRankCode || !selectedAgeBand) return;

      try {
        setIsLoadingRequirements(true);
        setError(null);
        const res = await getAllEffectiveSyllabusRequirements({
          rank_code: selectedRankCode,
          age_band: selectedAgeBand,
        });
        if (!active) return;
        setEffectiveRequirements(res.results || []);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load syllabus requirements.",
        );
      } finally {
        if (active) {
          setIsLoadingRequirements(false);
        }
      }
    }

    void fetchEffectiveRequirements();
    return () => {
      active = false;
    };
  }, [selectedRankCode, selectedAgeBand]);

  // Handle curriculum track change
  function handleCurriculumChange(newTrack: CurriculumTrack) {
    setCurriculumTrack(newTrack);
    if (newTrack === "JUNIOR_LITTLE_DRAGON") {
      if (selectedAgeBand !== "AGE_8_AND_UNDER" && selectedAgeBand !== "AGE_9_TO_12") {
        setSelectedAgeBand("AGE_9_TO_12");
      }
    } else {
      if (selectedAgeBand !== "AGE_13_TO_17" && selectedAgeBand !== "AGE_18_AND_OVER") {
        setSelectedAgeBand("AGE_18_AND_OVER");
      }
    }
  }

  // Handle age band change
  function handleAgeBandChange(newAgeBand: AgeBandEnum) {
    setSelectedAgeBand(newAgeBand);
    const option = AGE_BAND_OPTIONS.find((opt) => opt.value === newAgeBand);
    if (option) {
      setCurriculumTrack(option.track);
    }
  }

  // Scroll belt track
  function scrollBeltTrack(direction: "left" | "right") {
    if (!beltTrackRef.current) return;
    const scrollAmount = 240;
    beltTrackRef.current.scrollBy({
      left: direction === "left" ? -scrollAmount : scrollAmount,
      behavior: "smooth",
    });
  }

  // Determine current selected rank object and next rank
  const selectedRankIndex = ranks.findIndex((r) => r.code === selectedRankCode);
  const selectedRank = selectedRankIndex >= 0 ? ranks[selectedRankIndex] : null;
  const nextRank =
    selectedRankIndex >= 0 && selectedRankIndex < ranks.length - 1
      ? ranks[selectedRankIndex + 1]
      : null;

  const currentAgeOption = AGE_BAND_OPTIONS.find(
    (opt) => opt.value === selectedAgeBand,
  );

  const techniqueRows = effectiveRequirements.filter((row) => row.category === "TECHNIQUE_SET");
  const formRows = effectiveRequirements.filter((row) => row.category === "FORM");

  return (
    <section aria-labelledby="syllabus-heading" className="ledger-section syl-container">
      {/* Header */}
      <div className="section-header syl-header">
        <div>
          <h1 id="syllabus-heading">Syllabus</h1>
          <p className="section-subtitle">Teaching and grading requirements</p>
        </div>
      </div>

      {/* Top Filter Controls */}
      <div className="syl-filter-bar" aria-label="Syllabus filters">
        <div className="syl-filter-group">
          <label htmlFor="syl-curriculum-select" className="syl-filter-label">
            Curriculum
          </label>
          <select
            id="syl-curriculum-select"
            className="syl-select"
            value={curriculumTrack}
            onChange={(e) => handleCurriculumChange(e.target.value as CurriculumTrack)}
          >
            <option value="JUNIOR_LITTLE_DRAGON">Junior &amp; Little Dragon</option>
            <option value="ADULT_YOUTH">Adult &amp; Youth</option>
          </select>
        </div>

        <div className="syl-filter-group">
          <label htmlFor="syl-age-select" className="syl-filter-label">
            Age group
          </label>
          <select
            id="syl-age-select"
            className="syl-select"
            value={selectedAgeBand}
            onChange={(e) => handleAgeBandChange(e.target.value as AgeBandEnum)}
          >
            {AGE_BAND_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="syl-filter-group">
          <label htmlFor="syl-rank-select" className="syl-filter-label">
            Testing for
          </label>
          <select
            id="syl-rank-select"
            className="syl-select"
            value={selectedRankCode}
            onChange={(e) => setSelectedRankCode(e.target.value)}
            disabled={isLoadingRanks || ranks.length === 0}
          >
            {ranks.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Horizontal Belt Rail */}
      <div className="syl-belt-rail-wrapper">
        <button
          type="button"
          className="syl-nav-arrow syl-nav-arrow-left"
          onClick={() => scrollBeltTrack("left")}
          aria-label="Scroll ranks left"
        >
          ‹
        </button>

        <div
          ref={beltTrackRef}
          className="syl-belt-track"
          role="region"
          aria-label="Belt Rank Chapters"
          tabIndex={0}
        >
          {ranks.map((rank) => {
            const isSelected = rank.code === selectedRankCode;
            return (
              <button
                key={rank.code}
                type="button"
                className={`syl-belt-btn ${isSelected ? "syl-belt-btn-active" : ""}`}
                onClick={() => setSelectedRankCode(rank.code)}
                aria-pressed={isSelected}
                title={`Select ${rank.name}`}
              >
                <BeltSwatch rankCode={rank.code} rankName={rank.name} />
                <span className="syl-belt-label">{rank.name}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="syl-nav-arrow syl-nav-arrow-right"
          onClick={() => scrollBeltTrack("right")}
          aria-label="Scroll ranks right"
        >
          ›
        </button>
      </div>

      {/* Main Rank Chapter View */}
      <div className="syl-rank-content">
        {/* Rank Chapter Heading */}
        <div className="syl-rank-header">
          <div>
            <h2 className="syl-rank-title">
              {selectedRank ? selectedRank.name : selectedRankCode}
            </h2>
            <p className="syl-rank-subtitle">
              {currentAgeOption?.ageDisplay || "Curriculum requirements"}
            </p>
            <p className="syl-rank-everything-note">
              Everything examinable through {selectedRank ? selectedRank.name : selectedRankCode}.
            </p>
          </div>

          {nextRank && (
            <button
              type="button"
              className="syl-next-rank-btn"
              onClick={() => setSelectedRankCode(nextRank.code)}
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

        {/* Universal Core Grading Areas */}
        <div className="syl-section-block">
          <div className="syl-section-title-wrap">
            <h3 className="syl-section-title">Core grading areas</h3>
            <p className="syl-section-subtitle">
              Always assessed · all candidates are assessed in the following six areas.
            </p>
          </div>

          {isLoadingCoreAreas ? (
            <div className="syl-loading-state" aria-live="polite">
              <span className="syl-spinner" aria-hidden="true" />
              <span>Loading core grading areas…</span>
            </div>
          ) : (
            <div className="syl-core-grid">
              {coreAreas.map((area) => (
                <div key={area.id} className="syl-core-card">
                  <div className="syl-core-name">{area.name}</div>
                  {area.korean_name && <div className="syl-core-korean">{area.korean_name}</div>}
                  <div className="syl-core-english">{area.category_display}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Techniques Ledger */}
        <div className="syl-section-block">
          <div className="syl-section-title-wrap">
            <h3 className="syl-section-title">Techniques</h3>
            <p className="syl-section-subtitle">
              Cumulative through {selectedRank ? selectedRank.name : selectedRankCode}, latest
              range shown when a technique set was extended at a later rank.
            </p>
          </div>

          {isLoadingRequirements ? (
            <div className="syl-loading-state" aria-live="polite">
              <span className="syl-spinner" aria-hidden="true" />
              <span>Loading curriculum requirements…</span>
            </div>
          ) : (
            <SyllabusLedgerTable title="Techniques" rows={techniqueRows} />
          )}
        </div>

        {/* Forms Ledger */}
        <div className="syl-section-block">
          <div className="syl-section-title-wrap">
            <h3 className="syl-section-title">Forms</h3>
            <p className="syl-section-subtitle">
              Cumulative through {selectedRank ? selectedRank.name : selectedRankCode}.
            </p>
          </div>

          {isLoadingRequirements ? (
            <div className="syl-loading-state" aria-live="polite">
              <span className="syl-spinner" aria-hidden="true" />
              <span>Loading curriculum requirements…</span>
            </div>
          ) : (
            <SyllabusLedgerTable title="Forms" rows={formRows} />
          )}
        </div>
      </div>

      {/* Footer Reference */}
      <footer className="syl-footer">
        <div className="syl-footer-brand">
          <strong>KukGrade</strong>
          <span className="syl-footer-divider">|</span>
          <span>Past assessments retain their generated wording.</span>
        </div>
        <div className="syl-footer-reference">
          Preliminary reference: WKSA curriculum chart, 2014
        </div>
      </footer>
    </section>
  );
}
