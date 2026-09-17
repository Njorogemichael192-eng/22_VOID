# 22_VOID — COMPLETE ARBITRAGE ENGINE LOGIC & ALGORITHM

Version: 1.0
Date: 2026-09-17
Status: Core engineering specification

> This document defines the mathematical and software logic of the 22_VOID detection engine. It is intended to be given to the building agent as a core specification. It deliberately treats settlement semantics and outcome coverage as first-class problems.

---

# 1. ENGINE MISSION

22_VOID is not an odds calculator.

Its job is to answer one precise question:

> Given a set of currently available prices from different sources, do there exist stakes on those selections such that every relevant possible settlement state produces a return greater than the total amount staked?

The engine must therefore solve five separate problems:

1. **Identity** — Are these odds for the same event?
2. **Semantics** — Do these selections actually mean what their labels say?
3. **Coverage** — Do the selections collectively cover every relevant outcome state?
4. **Settlement** — What does each selection return in every state?
5. **Economics** — Can stakes be allocated so the worst-case return exceeds total stake?

A candidate is not an arbitrage until all five pass.

---

# 2. ABSOLUTE RULES

## Rule 1 — Never use reciprocal sums as the primary arb detector

The familiar condition:

```text
1/O1 + 1/O2 < 1
```

is only a shortcut for a very specific structure: mutually exclusive, collectively exhaustive outcomes with compatible all-or-nothing settlement.

It must NOT be used blindly for:

- overlapping totals;
- nested team/match markets;
- Asian whole lines;
- Asian quarter lines;
- markets containing pushes;
- half-win/half-loss structures;
- different periods;
- different settlement rules;
- markets that are not complements.

The engine's authoritative test is the payoff/state model.

## Rule 2 — Settlement rules come from the source, not the market name

"Asian handicap", "DNB", "Over 2.0", "Over 2.25" and similar labels are not sufficient by themselves.

The engine stores a normalized settlement rule version and its source/provider evidence.

Asian quarter lines are commonly split into two adjacent lines. For example, a -1.25 handicap can be treated as half on -1.0 and half on -1.5; a whole line can push when the adjusted margin is exactly zero. Actual bookmaker rules must be normalized and verified rather than assumed.

## Rule 3 — Unknown settlement means NO ARB

If 22_VOID cannot determine how a selection settles in every relevant state:

```text
candidate.status = INVALID
reason = UNKNOWN_SETTLEMENT
```

Never guess.

## Rule 4 — Unknown event identity means NO ARB

If two feeds might represent different matches:

```text
candidate.status = INVALID
reason = EVENT_MATCH_UNCERTAIN
```

## Rule 5 — Stale odds cannot become verified opportunities

A stale candidate may be retained historically, but it cannot be presented as currently verified.

## Rule 6 — Every result must be explainable

For every detected opportunity, the engine must be able to show:

- event;
- selections;
- bookmaker/source;
- odds;
- stake allocation;
- every relevant state or state class;
- each leg's settlement;
- portfolio return;
- minimum return;
- guaranteed profit;
- ROI;
- freshness;
- validation status.

---

# 3. HIGH-LEVEL PIPELINE

```text
RAW PROVIDER DATA
       |
       v
[1] INGEST
       |
       v
[2] SCHEMA VALIDATION
       |
       v
[3] EVENT NORMALIZATION
       |
       v
[4] MARKET NORMALIZATION
       |
       v
[5] SETTLEMENT-RULE VALIDATION
       |
       v
[6] ODDS SANITY CHECK
       |
       v
[7] CANDIDATE GENERATION
       |
       v
[8] OUTCOME-STATE GENERATION
       |
       v
[9] PAYOFF MATRIX
       |
       v
[10] COVERAGE TEST
       |
       v
[11] STAKE OPTIMIZATION
       |
       v
[12] WORST-CASE RETURN
       |
       v
[13] FRESHNESS / FINAL RECHECK
       |
       v
[14] OPPORTUNITY CLASSIFICATION
       |
       v
[15] PERSIST + DISPLAY
```

No stage may silently bypass a failed previous stage.

---

# 4. CORE DATA MODEL

## 4.1 Event

```text
Event {
    canonicalEventId
    sport
    competition
    homeTeam
    awayTeam
    startTime
    status
    sourceEventIds[]
}
```

## 4.2 Market

```text
Market {
    eventId
    period
    marketFamily
    marketType
    participant
    line
    settlementRuleId
    sourceMarketId
}
```

Examples:

```text
MATCH_TOTAL / STANDARD / line=2.5
MATCH_TOTAL / ASIAN / line=2.0
TEAM_TOTAL / HOME / line=1.5
ASIAN_HANDICAP / HOME / line=-0.75
MATCH_RESULT / 1X2
DOUBLE_CHANCE / X2
```

## 4.3 Selection

```text
Selection {
    marketId
    outcome
    odds
    bookmakerId
    providerId
    observedAt
    sourceUpdatedAt
}
```

## 4.4 Candidate

```text
Candidate {
    eventId
    selections[]
    structureType
    settlementConfidence
    eventConfidence
    stateModel
}
```

## 4.5 Opportunity

```text
Opportunity {
    status
    totalStake
    stakes[]
    minReturn
    guaranteedProfit
    roi
    worstState
    freshness
    validationEvidence[]
}
```

---

# 5. ODDS SANITY CHECK

Before mathematical analysis:

Reject:

```text
odds <= 1.0
odds = null
odds = NaN
odds = Infinity
```

Check:

- decimal format;
- source timestamp;
- market line;
- outcome;
- bookmaker;
- currency if stake calculations depend on it;
- suspension/closed status;
- market availability.

Do not silently convert malformed prices.

---

# 6. EVENT NORMALIZATION

Different providers can represent the same match differently:

```text
AC Milan
AC Milan FC
Milan
Milan AC
```

and:

```text
Benfica
SL Benfica
Benfica Lisbon
```

22_VOID creates canonical aliases.

Normalize:

- Unicode;
- whitespace;
- punctuation;
- casing;
- known abbreviations;
- team aliases.

Then compare:

- sport;
- home/away;
- competition where available;
- start time;
- source event identifiers.

## Event confidence

Example:

```text
same provider event ID        +1.0
exact canonical teams         +0.5
start time within tolerance   +0.3
competition matches           +0.2
```

The exact scoring system can be changed, but uncertain matches must never be silently merged.

---

# 7. MARKET NORMALIZATION

This is one of the most important modules.

The engine converts provider-specific labels into canonical representations.

Example:

```text
"Goals Over/Under"
"Total Goals"
"O/U"
```

may normalize to:

```text
MATCH_TOTAL / STANDARD
```

But:

```text
"Home Team Goals O/U"
```

must normalize to:

```text
TEAM_TOTAL / HOME
```

and never to MATCH_TOTAL.

Similarly:

```text
Corners O/U
Cards O/U
Goals O/U
Shots O/U
```

are different market families.

---

# 8. PERIOD NORMALIZATION

Every market must carry a period:

```text
FULL_MATCH
FIRST_HALF
SECOND_HALF
EXTRA_TIME
SET_1
MAP_1
etc.
```

Example:

```text
Full Match Over 2.5
```

is NOT interchangeable with:

```text
First Half Over 2.5
```

A period mismatch automatically invalidates the candidate.

For live markets, also store the relevant "as-of" state because some live Asian rules settle only on events occurring after the bet was placed. Some bookmaker rules explicitly treat live Asian handicaps according to the remainder after placement.

---

# 9. SETTLEMENT MODEL

Every selection must map each state to a settlement outcome.

Canonical result:

```text
FULL_WIN
FULL_LOSS
PUSH
HALF_WIN
HALF_LOSS
VOID
```

The model should also be capable of storing a lower-level component result:

```text
WIN
LOSS
PUSH
VOID
```

because a quarter line is effectively a combination of component lines.

---

# 10. PAYOUT FORMULAS

For stake `S` and decimal odds `O`:

## Full win

```text
return = S * O
```

## Full loss

```text
return = 0
```

## Push

```text
return = S
```

## Half win

If half the stake wins and half is returned:

```text
return = (S/2 * O) + (S/2)
       = S * (O + 1) / 2
```

## Half loss

If half is lost and half returned:

```text
return = S/2
```

## Void

```text
return = S
```

These formulas must be unit tested.

---

# 11. STANDARD TOTALS

For a match score:

```text
H = home goals
A = away goals
T = H + A
```

For Over 2.5:

```text
WIN if T >= 3
LOSS if T <= 2
```

For Under 2.5:

```text
WIN if T <= 2
LOSS if T >= 3
```

These are exact complements.

Therefore:

```text
Over 2.5 + Under 2.5
```

can form a classic two-outcome structure, subject to odds and other constraints.

---

# 12. WHOLE ASIAN TOTALS

For Over 2.0:

```text
T > 2  -> WIN
T = 2  -> PUSH
T < 2  -> LOSS
```

For Under 2.0:

```text
T < 2  -> WIN
T = 2  -> PUSH
T > 2  -> LOSS
```

The engine must NOT treat the push as a third independent match result. It is a settlement result of the selected wager.

---

# 13. QUARTER ASIAN TOTALS

A quarter line is represented as two component lines.

Example:

```text
Over 2.25
```

becomes:

```text
50% Over 2.0
50% Over 2.5
```

Example:

```text
Over 2.75
```

becomes:

```text
50% Over 2.5
50% Over 3.0
```

The engine evaluates each component and combines returns.

This is the same fundamental mechanism used for quarter Asian lines in sportsbook rules.

---

# 14. ASIAN HANDICAP

Define goal margin:

```text
M = H - A
```

For a Home handicap `L`:

```text
adjusted = M + L
```

For whole and half lines:

```text
adjusted > 0 -> WIN
adjusted = 0 -> PUSH
adjusted < 0 -> LOSS
```

But for quarter lines, split into two adjacent lines.

Example:

```text
Home -0.75
```

becomes:

```text
Home -0.5
Home -1.0
```

with 50% stake on each.

A home win by exactly one produces:

```text
-0.5 -> WIN
-1.0 -> PUSH
```

therefore:

```text
HALF_WIN
```

Quarter-line behavior must be computed from component settlements, not from a hand-written list of special cases.

---

# 15. GENERIC SETTLEMENT ENGINE

Instead of writing:

```text
if line == -0.75 ...
```

write:

```text
SettlementRule.evaluate(state, selection)
```

Conceptually:

```text
evaluate(selection, state):

    if selection is standard total:
        return evaluateStandardTotal(...)

    if selection is Asian total:
        components = splitAsianLine(selection.line)
        componentResults = evaluateEachComponent(...)
        return combine(componentResults)

    if selection is Asian handicap:
        components = splitAsianLine(selection.line)
        componentResults = evaluateEachComponent(...)
        return combine(componentResults)

    if selection is 1X2:
        return evaluateResult(...)

    ...
```

This prevents a huge collection of fragile special cases.

---

# 16. OUTCOME STATE ENGINE

The engine needs possible states.

For football full-match goals:

```text
(H,A)
```

Examples:

```text
(0,0)
(0,1)
(1,0)
(1,1)
(2,0)
(0,2)
...
```

The challenge is that football theoretically has no hard maximum score.

Therefore the engine needs a **mathematically safe state reduction strategy**.

---

# 17. SCORE-STATE REDUCTION

Do NOT simply enumerate:

```text
0..1000 goals
```

for every candidate.

Instead, derive the threshold boundaries that can change settlement.

Example:

```text
Over 2.5
Under 4.5
Home Over 1.5
```

The relevant thresholds are:

```text
total = 2/3
total = 4/5
home = 1/2
```

The state engine can partition the infinite score space into equivalence classes where all selections have the same settlement behavior.

This is crucial.

---

# 18. STATE EQUIVALENCE

Two score states are equivalent for a candidate if every selection in the candidate settles identically in both.

Example:

If the candidate only contains:

```text
Over 2.5
Under 2.5
```

then:

```text
(3,0)
(2,1)
(10,0)
(7,4)
```

all have:

```text
Over = WIN
Under = LOSS
```

So they are economically equivalent for this candidate.

The engine can represent them as a single state class:

```text
TOTAL >= 3
```

This dramatically reduces computation.

---

# 19. STATE PARTITION ALGORITHM

For a candidate:

### Step 1
Extract every numeric boundary affecting settlement.

Examples:

```text
home thresholds
away thresholds
total thresholds
margin thresholds
corner thresholds
card thresholds
```

### Step 2
Sort boundaries.

### Step 3
Generate intervals and exact boundary states.

For integer football variables:

If threshold is:

```text
2.5
```

the relevant split is:

```text
<=2
>=3
```

If threshold is:

```text
2.0
```

the exact state matters:

```text
<=1
=2
>=3
```

because `=2` can push.

### Step 4
Generate representative score states for each equivalence class.

### Step 5
Verify that all states inside the class have identical settlement vectors.

If not, split the class.

---

# 20. WHY STATE REDUCTION MATTERS

Without reduction:

```text
candidate combinations × thousands of scores × bookmakers
```

becomes expensive.

With reduction:

```text
candidate combinations × small number of settlement classes
```

the engine remains practical.

---

# 21. COVERAGE MATRIX

Suppose a candidate has three selections:

```text
S1 = Team A Over 1.5
S2 = Team B Over 1.5
S3 = Match Under 3.5
```

For a score:

```text
2-0
```

we get:

```text
S1 = WIN
S2 = LOSS
S3 = WIN
```

For:

```text
1-1
```

we get:

```text
S1 = LOSS
S2 = LOSS
S3 = WIN
```

For:

```text
2-2
```

we get:

```text
S1 = WIN
S2 = WIN
S3 = LOSS
```

The important point is that multiple selections can win in one state.

That is allowed.

The requirement is:

> The portfolio must never produce an insufficient return in any state.

---

# 22. PAYOFF MATRIX

For each state `x` and selection `i`, calculate:

```text
P[i,x](stake)
```

Example:

```text
                 State A   State B   State C
Selection 1        WIN       LOSS       WIN
Selection 2        LOSS      WIN        WIN
Selection 3        WIN       WIN        LOSS
```

Then for stakes:

```text
S1
S2
S3
```

portfolio return:

```text
R(A) = return(S1,A) + return(S2,A) + return(S3,A)
R(B) = return(S1,B) + return(S2,B) + return(S3,B)
R(C) = return(S1,C) + return(S2,C) + return(S3,C)
```

---

# 23. ARBITRAGE CONDITION

Given total stake:

```text
T = S1 + S2 + ... + Sn
```

calculate:

```text
Rmin = min(R(state1), R(state2), ..., R(stateN))
```

Then:

```text
GUARANTEED PROFIT = Rmin - T
```

A theoretical guaranteed-profit arb requires:

```text
Rmin > T
```

or equivalently:

```text
Rmin - T > 0
```

ROI:

```text
ROI = (Rmin - T) / T
```

---

# 24. STAKE OPTIMIZATION

The engine should not assume proportional stakes for complex structures.

Solve:

```text
maximize z
```

subject to:

```text
sum(Si) = T

portfolioReturn(state_j) >= z
for every relevant state_j

Si >= 0
```

Then:

```text
z = maximum guaranteed return
```

If:

```text
z <= T
```

there is no guaranteed-profit arb for that candidate.

---

# 25. LINEAR PROGRAMMING MODEL

For a simple full-win/full-loss matrix:

```text
A[j][i] = payout multiplier of selection i in state j
```

Then:

```text
Rj = Σ(A[j][i] * Si)
```

Optimization:

```text
maximize z

subject to:

Σ Si = T

Σ(A[j][i] * Si) >= z
for j = 1..N

Si >= 0
```

For push and half outcomes, `A[j][i]` simply uses the correct return multiplier.

Example:

```text
FULL_WIN  -> O
PUSH      -> 1
HALF_WIN  -> (O+1)/2
HALF_LOSS -> 0.5
LOSS      -> 0
VOID      -> 1
```

---

# 26. EXAMPLE — CLASSIC TWO-WAY ARB

Suppose:

```text
Over 2.5 @ 2.20
Under 2.5 @ 2.10
```

The outcomes are complementary.

The classic condition:

```text
1/2.20 + 1/2.10 < 1
```

is valid here because the market is a genuine two-way partition.

But the engine should still build:

```text
T <= 2
T >= 3
```

and verify:

```text
Over = LOSS, Under = WIN
Over = WIN, Under = LOSS
```

Then optimize stakes.

---

# 27. EXAMPLE — FALSE OVERLAP

Suppose:

```text
Over 10.5 @ 2.01
Under 13.5 @ 2.24
```

Possible total:

```text
11
```

produces:

```text
Over 10.5 = WIN
Under 13.5 = WIN
```

Both can win.

Therefore this is not a simple two-outcome partition.

The reciprocal sum must not automatically classify it as an arb.

The engine records:

```text
candidate.structure = OVERLAPPING_TOTALS
candidate.result = NOT_ARB
reason = NON_EXCLUSIVE_SELECTIONS
```

---

# 28. EXAMPLE — BOTH-LOSS

Suppose:

```text
Team A Under 8.5
Match Total Over 8.5
```

A score such as:

```text
7-2
```

produces:

```text
Team A Under 8.5 = WIN
Match Over 8.5 = WIN
```

but:

```text
7-1
```

produces:

```text
Team A Under 8.5 = WIN
Match Over 8.5 = LOSS
```

and:

```text
9-0
```

produces:

```text
Team A Under 8.5 = LOSS
Match Over 8.5 = WIN
```

The engine must inspect all relevant states.

If a both-loss state exists:

```text
Team A = 9
Away = 0
```

then both selections cannot protect the portfolio.

Reject.

---

# 29. EXAMPLE — PUSH-AWARE STRUCTURE

Consider:

```text
Over 1.0 @ 1.55
Under 1.5 @ 1.60
```

States:

```text
T=0:
Over 1.0 = LOSS
Under 1.5 = WIN

T=1:
Over 1.0 = PUSH
Under 1.5 = WIN

T>=2:
Over 1.0 = WIN
Under 1.5 = LOSS
```

This is structurally different from:

```text
Under 1.0
Over 1.5
```

where:

```text
T=0:
Under = WIN
Over = LOSS

T=1:
Under = PUSH
Over = LOSS

T>=2:
Under = LOSS
Over = WIN
```

The engine must therefore model exact settlement states rather than assume "Over/Under are opposites."

---

# 30. CROSS-MARKET LOGIC

The engine must support relationships between different market families.

Example:

```text
Home Team Under 1.5
+
Match Over 1.5
```

For home goals:

```text
H <= 1:
Home Under 1.5 = WIN

H >= 2:
Total >= 2
Match Over 1.5 = WIN
```

This can create complete coverage.

But **coverage alone does not establish profitability**.

The optimizer must calculate the actual minimum portfolio return.

---

# 31. THREE-LEG STRUCTURES

Example:

```text
Home Over 1.5
Away Over 1.5
Match Under 3.5
```

Reason:

If Home >= 2:

```text
Home Over wins
```

If Away >= 2:

```text
Away Over wins
```

If neither reaches 2:

```text
Home <= 1
Away <= 1
Total <= 2
```

therefore:

```text
Match Under 3.5 wins
```

Some states have two winning legs.

That is allowed.

The optimizer determines whether those overlapping returns are enough to guarantee profit.

---

# 32. MARKET RELATIONSHIP GRAPH

22_VOID should eventually construct a relationship graph.

Example:

```text
MATCH_TOTAL 2.5
    |
    +-- complementary --> MATCH_TOTAL 2.5 opposite
    |
    +-- related --------> TEAM_TOTAL HOME 1.5
    |
    +-- related --------> TEAM_TOTAL AWAY 1.5
```

Edges can describe:

```text
COMPLEMENT
SUBSET
SUPERSET
OVERLAP
PARTITION
CONDITIONAL_COVER
SAME_EVENT
SAME_PERIOD
```

This helps candidate generation without brute-forcing every combination.

---

# 33. CANDIDATE GENERATION

Never compare every selection with every other selection blindly.

Use stages.

## Stage A — same event

Group all normalized markets by canonical event.

## Stage B — same period

Reject mismatched periods.

## Stage C — compatible market families

Use a compatibility table.

Example:

```text
MATCH_TOTAL ↔ MATCH_TOTAL
MATCH_TOTAL ↔ TEAM_TOTAL
TEAM_TOTAL ↔ MATCH_TOTAL
ASIAN_TOTAL ↔ ASIAN_TOTAL
ASIAN_HANDICAP ↔ ASIAN_HANDICAP
1X2 ↔ DOUBLE_CHANCE
```

Only enable cross-family combinations that have an implemented state model.

## Stage D — candidate size

Start:

```text
2-leg
```

then:

```text
3-leg
```

then larger structures only where the relationship graph indicates potential coverage.

---

# 34. CANDIDATE PRUNING

Reject early when:

- same bookmaker where simultaneous placement is impossible/undesirable under project policy;
- same exact selection duplicated;
- odds invalid;
- event uncertain;
- period mismatch;
- settlement unknown;
- suspended selection;
- market incompatible;
- candidate contains impossible duplicate outcome;
- freshness exceeds threshold.

This reduces computation.

---

# 35. BOOKMAKER CONSTRAINTS

The engine must not assume that an arbitrage is executable merely because mathematics works.

Store:

```text
minimum stake
maximum stake
maximum payout
market status
account restrictions if legitimately known
odds timestamp
```

If limits are available from the provider, optimize under them.

Example:

```text
0 <= Si <= maxStake_i
```

and, if a maximum payout applies:

```text
return_i <= maxPayout_i
```

If limits are unknown, label the result:

```text
MATHEMATICAL_ONLY
```

not "execution guaranteed."

---

# 36. STAKE ROUNDING

Real bookmakers may require stakes such as:

```text
KSh 1
KSh 5
KSh 10
```

The optimizer may produce:

```text
S1 = 1,237.483
S2 = 2,762.517
```

The execution layer must round to permitted increments and then recompute every state.

Never round and assume the guarantee remains.

Process:

```text
continuous optimum
      ↓
round to bookmaker increments
      ↓
recalculate payoff matrix
      ↓
recalculate minimum return
      ↓
accept/reject
```

---

# 37. CURRENCY

The engine should use one internal base currency for calculations.

For a Kenya-focused interface:

```text
KES
```

But odds themselves are currency-independent.

If multiple currencies are ever supported:

```text
stakeCurrency
providerCurrency
fxRate
fxTimestamp
```

must be stored.

FX uncertainty must not be hidden inside an arbitrage result.

---

# 38. ODDS FRESHNESS

Every price has:

```text
sourceUpdatedAt
ingestedAt
detectedAt
```

Define:

```text
age = now - sourceUpdatedAt
```

Use configurable thresholds:

```text
FRESH
AGING
STALE
```

Example policy:

```text
< 5 seconds   FRESH
5–15 seconds  AGING
> 15 seconds  STALE
```

These are configuration examples, not universal rules.

Different providers may need different thresholds.

---

# 39. FINAL RECHECK

Before a high-confidence opportunity is displayed:

```text
candidate found
     ↓
re-fetch current odds
     ↓
compare prices
     ↓
rebuild candidate
     ↓
recalculate settlement
     ↓
recalculate optimization
     ↓
recalculate minimum return
```

If price changed:

```text
INVALIDATED
```

or recompute.

Never display stale calculations as live facts.

---

# 40. OPPORTUNITY STATUS

Recommended statuses:

```text
DETECTED
VALIDATING
THEORETICAL_ARB
FRESH_ARB
VERIFIED_ARB
STALE
INVALIDATED
REJECTED
```

Reasons for rejection should be structured:

```text
UNKNOWN_SETTLEMENT
EVENT_MISMATCH
PERIOD_MISMATCH
NON_EXHAUSTIVE
NON_EXCLUSIVE
BOTH_LOSS_STATE
NEGATIVE_GUARANTEED_PROFIT
STALE_ODDS
INVALID_ODDS
STAKE_LIMIT
ROUNDING_DESTROYS_PROFIT
PROVIDER_ERROR
```

---

# 41. FALSE-ARB REASONING ENGINE

Every rejection should produce machine-readable evidence.

Example:

```json
{
  "status": "REJECTED",
  "reason": "BOTH_LOSS_STATE",
  "state": {
    "homeGoals": 7,
    "awayGoals": 4
  },
  "settlements": [
    "LOSS",
    "LOSS"
  ]
}
```

This makes debugging possible.

---

# 42. OPPORTUNITY EXPLANATION

For a detected arb, generate:

```text
Why it qualifies:
- Same canonical event
- Same settlement period
- Settlement rules verified
- All relevant state classes covered
- Worst-case return = KSh X
- Total stake = KSh Y
- Guaranteed profit = KSh Z
- ROI = N%
- Freshness = X seconds
```

Do not merely display:

```text
ARB FOUND!!!
```

---

# 43. EXPLANATION OF EACH STATE

For every important state:

```text
State: Home 1 — Away 0

Leg 1:
Home Under 1.5
=> WIN
Return: ...

Leg 2:
Match Over 1.5
=> LOSS
Return: ...

Portfolio return:
...

Profit:
...
```

For large state classes:

```text
Home goals <= 1
```

show the class and representative examples.

---

# 44. GUARANTEED RETURN VS EXPECTED RETURN

22_VOID is an arbitrage engine, not a prediction engine.

The core metric is:

```text
MINIMUM GUARANTEED RETURN
```

not:

```text
expected match result
probability of winning
team strength
prediction
```

The engine must never use statistical predictions to manufacture a mathematical guarantee.

---

# 45. CLASSIC ARB SHORTCUT

Once the general state engine confirms:

```text
two selections
same market
same line
exact complements
no push
full coverage
```

the engine may use the optimized closed-form calculation as a performance shortcut.

For total stake `T`:

```text
S1 = T * (1/O1) / ((1/O1)+(1/O2))
S2 = T * (1/O2) / ((1/O1)+(1/O2))
```

Then still verify the result through the general payoff engine.

The shortcut is an optimization, not the authority.

---

# 46. THREE-WAY CLASSIC ARB

For mutually exclusive and exhaustive outcomes:

```text
1
X
2
```

calculate:

```text
q1 = 1/O1
q2 = 1/O2
q3 = 1/O3

Q = q1 + q2 + q3
```

Classic arb exists if:

```text
Q < 1
```

Proportional stakes:

```text
Si = T * qi / Q
```

Then verify through the state engine.

---

# 47. 1X2 + DOUBLE CHANCE

Potential structure:

```text
Home win
+
X2
```

These are complementary if they refer to the same event, period and result definition:

```text
Home win
or
Draw/Away
```

The engine should normalize the selection as a set of result states:

```text
Home = {H_WIN}
X2 = {DRAW, AWAY_WIN}
```

Then test coverage.

This set-based representation is more robust than string comparison.

---

# 48. OUTCOME SET REPRESENTATION

Each market selection should expose a semantic predicate:

```text
settlesAs(selection, state)
```

or, for richer settlement:

```text
settlement(selection, state)
```

For simple markets:

```text
Home win
```

means:

```text
H > A
```

For:

```text
X2
```

means:

```text
H <= A
```

For:

```text
Over 2.5
```

means:

```text
H + A >= 3
```

For:

```text
Home Under 1.5
```

means:

```text
H <= 1
```

This is the semantic foundation of cross-market detection.

---

# 49. SET-BASED COVERAGE

For pure win/loss markets:

```text
OutcomeSet(selection)
```

For every state:

```text
at least one selected outcome must win
```

But for profitability:

```text
portfolioReturn(state) > T
```

must hold after optimization.

Coverage and profitability are separate checks.

---

# 50. PUSH STATES

Push states require special handling.

A push is not the same as a win.

Example:

```text
Over 2.0
```

at:

```text
T=2
```

returns the stake but creates no profit.

The portfolio may still be profitable because another leg wins.

Therefore the engine must calculate actual returns rather than simply count "covered" states.

---

# 51. HALF-WIN / HALF-LOSS

Never convert:

```text
HALF_WIN
```

into:

```text
WIN
```

for financial calculations.

The exact return is required.

Likewise:

```text
HALF_LOSS
```

is not:

```text
LOSS
```

because half the stake is returned.

---

# 52. VOID

A void returns the stake.

This can happen due to:

- whole-line push;
- bookmaker cancellation;
- market-specific rule.

The engine must distinguish:

```text
PUSH
```

from:

```text
VOID
```

semantically, even if both can return the stake, because their operational causes and source rules differ.

---

# 53. MARKET RULE VERSIONING

Settlement rules can change.

Store:

```text
settlementRuleId
provider
version
effectiveFrom
effectiveTo
sourceReference
```

Historical odds should be evaluated using the applicable rule version.

Never silently apply today's rule to historical data if the provider rule changed.

---

# 54. PROVIDER CONFLICTS

If Provider A says:

```text
Over 2.5 @ 2.10
```

and Provider B says:

```text
Over 2.5 @ 2.08
```

normal.

If Provider A says:

```text
Asian Over 2.0
```

and Provider B says:

```text
Standard Over 2.0
```

do NOT automatically treat them as equivalent.

Market semantics must win over label similarity.

---

# 55. BOOKMAKER PRICE SELECTION

For a given canonical selection:

```text
select the highest valid current price
```

subject to:

- source validity;
- freshness;
- bookmaker availability;
- market identity;
- settlement compatibility.

But preserve all source prices for audit and comparison.

---

# 56. MULTIPLE ODDS FROM SAME BOOKMAKER

If two legs are both from the same bookmaker, this may still be mathematically valid, but execution constraints can differ.

The engine should therefore expose:

```text
bookmakerCount
uniqueBookmakers
```

and allow configurable policies:

```text
REQUIRE_UNIQUE_BOOKMAKERS = true/false
```

Do not hard-code assumptions.

---

# 57. EXECUTION RISK

Mathematical arb ≠ guaranteed real-world execution.

The engine should distinguish:

```text
MATHEMATICAL_ARBITRAGE
```

from:

```text
EXECUTION_VERIFIED
```

Execution verification can consider:

- current odds;
- market open;
- limits;
- stake rounding;
- bookmaker availability;
- placement confirmation where legitimate integration exists.

---

# 58. OPPORTUNITY SCORING

Do not use an arbitrary "best arb" score to hide mathematical uncertainty.

Instead show separate fields:

```text
ROI
Guaranteed Profit
Minimum Return
Number of Legs
Odds Age
Event Confidence
Settlement Confidence
Provider Reliability
Execution Risk
```

Users can decide how to filter.

---

# 59. NO PREDICTIVE RANKING

The engine must never say:

```text
Team A is more likely to win.
```

It is calculating structural pricing opportunities.

It does not need:

- team form;
- league position;
- player injuries;
- predicted winner;
- bookmaker opinion.

Those may be future analytics modules, but they are not required for arbitrage verification.

---

# 60. PERFORMANCE ARCHITECTURE

Do not run the full engine over every possible combination.

Use:

```text
event partition
    ↓
period partition
    ↓
market family compatibility
    ↓
line relationship
    ↓
price prefilter
    ↓
state model
    ↓
optimization
```

Only expensive optimization occurs after cheap structural filters.

---

# 61. PRICE PREFILTER

For classic two-way candidates:

```text
Q = 1/O1 + 1/O2
```

If:

```text
Q >= 1
```

and the structure is known to be a standard exact complement, reject without optimization.

For complex structures, do not use Q as a rejection rule unless the mathematical relationship guarantees its validity.

---

# 62. CANDIDATE CACHE

Cache normalized market structures.

Key example:

```text
eventId:
period:
marketFamily:
line:
participant:
settlementRuleVersion:
```

When only odds change, don't rebuild semantic market structures unnecessarily.

---

# 63. INCREMENTAL DETECTION

When one price changes:

```text
changed selection
      ↓
find affected canonical market
      ↓
find candidate combinations containing it
      ↓
recalculate only affected candidates
```

Do not recompute the entire database on every tick.

---

# 64. DATABASE INDEXES

Important indexes:

```text
events(canonical_event_id)
events(start_time)
markets(event_id, market_family, period, line)
selections(market_id, outcome)
odds(market_id, bookmaker_id, observed_at)
opportunities(status, detected_at)
```

Additional indexes should be driven by actual query plans.

---

# 65. RAW DATA RETENTION

Store raw provider payloads long enough to debug:

```text
provider
requestId
receivedAt
payload
```

But apply retention policies so storage doesn't grow without control.

---

# 66. AUDIT TRAIL

Every opportunity should be reconstructable.

Store:

```text
input odds
normalization version
settlement rule version
state-model version
optimizer version
result
timestamp
```

This lets developers answer:

> Why did 22_VOID call this an arb?

---

# 67. ENGINE VERSIONING

Every opportunity stores:

```text
engineVersion
normalizerVersion
settlementVersion
optimizerVersion
```

If a bug is fixed, historical results remain attributable to the old engine version.

---

# 68. TEST STRATEGY

Every market evaluator must have:

1. boundary tests;
2. normal tests;
3. extreme tests;
4. push tests;
5. half-win tests;
6. half-loss tests;
7. invalid input tests.

Example for Over 2.5:

```text
2 goals -> LOSS
3 goals -> WIN
```

Example for Over 2.0:

```text
1 -> LOSS
2 -> PUSH
3 -> WIN
```

Example for Home -1.0:

```text
win by 2 -> WIN
win by 1 -> PUSH
draw -> LOSS
lose -> LOSS
```

Example for Home -0.75:

```text
win by 2 -> FULL_WIN
win by 1 -> HALF_WIN
draw -> FULL_LOSS
lose -> FULL_LOSS
```

These examples follow standard Asian settlement mechanics, but provider-specific rules must still be the source of truth.

---

# 69. PROPERTY-BASED TESTING

Where possible, generate random football scores.

For example:

```text
for H in 0..20:
    for A in 0..20:
        evaluate all relevant markets
```

Check invariants:

- no settlement returns undefined;
- no NaN;
- no negative payout;
- complementary standard totals cannot both lose;
- complementary standard totals cannot both win;
- whole Asian total at exact line pushes;
- quarter line equals its two component lines;
- stake sums equal requested stake after continuous optimization;
- portfolio return equals sum of leg returns.

---

# 70. GOLDEN TESTS

Maintain a fixed collection of known cases.

Example:

```text
CASE-001:
Over 2.5 @ 2.10
Under 2.5 @ 2.10
Expected: no arb if Q >= 1

CASE-002:
Over 2.5 @ 2.20
Under 2.5 @ 2.10
Expected: classic arb

CASE-003:
Over 10.5 + Under 13.5
Expected: reject due overlap

CASE-004:
Home Under 1.5 + Match Over 1.5
Expected: structurally exhaustive; optimizer decides profitability

CASE-005:
Over 1.0 + Under 1.5
Expected: push-aware states
```

---

# 71. ERROR HANDLING

Never fail silently.

Provider failure:

```text
PROVIDER_UNAVAILABLE
```

Malformed odds:

```text
INVALID_ODDS_PAYLOAD
```

Unknown market:

```text
UNSUPPORTED_MARKET
```

Unknown settlement:

```text
UNKNOWN_SETTLEMENT
```

Unmatched event:

```text
EVENT_MATCH_FAILED
```

Optimization failure:

```text
OPTIMIZATION_FAILED
```

---

# 72. OBSERVABILITY

Every scan cycle should report:

```text
provider
events received
events normalized
markets received
markets normalized
candidate count
rejected candidate count
state evaluations
optimization count
arbs detected
stale prices
errors
latency
```

This tells us where the system is failing.

---

# 73. ENGINE OUTPUT CONTRACT

Conceptually:

```json
{
  "status": "VERIFIED_ARB",
  "event": {
    "home": "Team A",
    "away": "Team B"
  },
  "legs": [
    {
      "bookmaker": "Book A",
      "market": "TEAM_TOTAL",
      "selection": "HOME_UNDER_1_5",
      "odds": 2.10,
      "stake": 500
    },
    {
      "bookmaker": "Book B",
      "market": "MATCH_TOTAL",
      "selection": "OVER_1_5",
      "odds": 2.20,
      "stake": 500
    }
  ],
  "totalStake": 1000,
  "minimumReturn": 1080,
  "guaranteedProfit": 80,
  "roi": 0.08,
  "worstState": "...",
  "freshness": "...",
  "validation": {
    "event": true,
    "settlement": true,
    "coverage": true,
    "optimization": true,
    "freshness": true
  }
}
```

The actual API schema should be strongly typed.

---

# 74. COMPLETE PSEUDOCODE

```text
function scanEvent(eventId):

    event = loadCanonicalEvent(eventId)

    if event is null:
        return

    sourceMarkets = loadCurrentMarkets(event)

    validMarkets = []

    for market in sourceMarkets:

        if !validateMarketSchema(market):
            recordReject(market, INVALID_MARKET)
            continue

        normalized = normalizeMarket(market)

        if normalized is null:
            recordReject(market, UNSUPPORTED_MARKET)
            continue

        if !settlementRuleKnown(normalized):
            recordReject(market, UNKNOWN_SETTLEMENT)
            continue

        validMarkets.add(normalized)


    candidates = generateCandidates(validMarkets)


    for candidate in candidates:

        if !eventIdentityValid(candidate):
            reject(candidate, EVENT_MATCH_FAILED)
            continue

        if !periodCompatible(candidate):
            reject(candidate, PERIOD_MISMATCH)
            continue

        if !allOddsValid(candidate):
            reject(candidate, INVALID_ODDS)
            continue

        if !allSettlementsKnown(candidate):
            reject(candidate, UNKNOWN_SETTLEMENT)
            continue

        states = generateRelevantStateClasses(candidate)

        if states is empty:
            reject(candidate, NO_STATE_MODEL)
            continue

        payoffMatrix = []

        for state in states:

            row = []

            for leg in candidate.legs:

                settlement = evaluateSettlement(
                    leg.selection,
                    state,
                    leg.settlementRule
                )

                returnMultiplier =
                    settlementToReturnMultiplier(
                        settlement,
                        leg.odds
                    )

                row.add(returnMultiplier)

            payoffMatrix.add(row)


        if !coverageIsValid(payoffMatrix):
            reject(candidate, INCOMPLETE_COVERAGE)
            continue


        solution = optimizeStakes(
            payoffMatrix,
            candidate.constraints,
            candidate.totalStake
        )

        if solution.failed:
            reject(candidate, OPTIMIZATION_FAILED)
            continue


        minReturn = calculateMinimumReturn(
            solution.stakes,
            payoffMatrix
        )

        profit = minReturn - candidate.totalStake


        if profit <= tolerance:
            reject(candidate, NEGATIVE_GUARANTEED_PROFIT)
            continue


        freshness = evaluateFreshness(candidate)

        if freshness == STALE:
            persistTheoretical(candidate, STALE)
            continue


        finalPrices = recheckPrices(candidate)

        if pricesChangedMaterially(finalPrices):
            invalidate(candidate)
            continue


        finalCandidate = rebuildWithFinalPrices(finalPrices)

        finalVerification = runFullValidation(finalCandidate)

        if !finalVerification.passed:
            invalidate(candidate)
            continue


        opportunity = createVerifiedOpportunity(
            finalCandidate,
            solution,
            minReturn,
            profit
        )

        persist(opportunity)
        publish(opportunity)
```

---

# 75. FINAL DECISION TREE

```text
                ODDS ARRIVE
                     |
                     v
              Valid payload?
                /       \
              NO         YES
              |           |
           REJECT         v
                    Same event?
                    /       \
                  NO         YES
                  |           |
               REJECT         v
                         Same period?
                         /       \
                       NO         YES
                       |           |
                    REJECT         v
                            Known settlement?
                              /       \
                            NO         YES
                            |           |
                         REJECT         v
                              Compatible markets?
                                /       \
                              NO         YES
                              |           |
                           REJECT         v
                            Generate states
                                  |
                                  v
                           Full coverage?
                             /       \
                           NO         YES
                           |           |
                        REJECT         v
                         Optimize stakes
                                  |
                                  v
                           minReturn > stake?
                             /       \
                           NO         YES
                           |           |
                        REJECT         v
                           Fresh?
                         /      \
                       NO        YES
                       |          |
                     STALE        v
                              FINAL RECHECK
                                  |
                                  v
                              Still valid?
                               /       \
                             NO         YES
                             |           |
                         INVALIDATED    v
                               VERIFIED ARB
```

---

# 76. WHAT THE ENGINE MUST NEVER DO

Never:

- call every `sum(1/odds) < 1` an arb;
- assume market names are equivalent;
- assume two Over/Under lines are complements;
- ignore exact whole-number Asian pushes;
- ignore quarter-line splitting;
- ignore half-win/half-loss;
- ignore both-loss states;
- ignore uncovered states;
- mix first-half and full-match markets;
- mix pre-match and live settlement assumptions;
- merge uncertain events;
- use stale prices as live;
- round stakes without recalculating;
- hide bookmaker/source identity;
- hide settlement assumptions;
- invent missing odds;
- invent settlement rules;
- expose provider API keys;
- bypass access controls;
- claim real-world execution is guaranteed merely because the mathematical model is positive.

---

# 77. FINAL ENGINE PHILOSOPHY

The core principle of 22_VOID is:

```text
UNDERSTAND THE MARKET
        ↓
UNDERSTAND THE SETTLEMENT
        ↓
UNDERSTAND EVERY POSSIBLE STATE
        ↓
BUILD THE PAYOFF MATRIX
        ↓
PROVE COMPLETE COVERAGE
        ↓
OPTIMIZE THE STAKES
        ↓
PROVE POSITIVE WORST-CASE RETURN
        ↓
VERIFY FRESH PRICES
        ↓
ONLY THEN CALL IT AN ARBITRAGE
```

The most important engineering idea is:

> **22_VOID should reason from settlement states, not from betting labels.**

If the labels say "Over", "Under", "1", "X2", "-0.75", "Under 3.5", etc., the engine converts those labels into formal settlement functions. The formal functions are what the arbitrage engine trusts.

That design is what allows 22_VOID to discover non-obvious cross-market structures while rejecting deceptive/false arbitrages.