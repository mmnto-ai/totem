# R4 run record — the calibrated-floor arm (mmnto-ai/totem#2727)

Pre-registered in `r4-preregistration.md` (commit 1, script unexecuted); this record is commit 2. Generated 2026-09-04T00:27:12.462Z by `scripts/r4-floor-arm.mjs` over `../spec-runs-2026-09-02/` at pin `14daff4d`.

## Method

1. Two floor shapes over the 55 recorded `totem spec` queries: **A-post** withholds delivered baseline items whose vector relevance is below τ (an FTS-only item, which has no relevance, is exempt); **A-pre** removes sub-τ items from the vector leg, compacts the surviving vector ranks, re-fuses the recorded pool with RRF k = 60 and re-takes the top 5 specs / 3 code. **B** is the A-pre shape with a per-query τ derived from that query’s best vector relevance.
2. Correctness is the R1 scorer’s `precision()`: a hit is label 2, the denominator is the delivered count, an unlabelled delivered item is a non-hit. Mean p@8 / p@5-spec / p@3-code over the 31 issue-anchored queries; the 24 topic queries are reported beside and do not enter the falsifier.
3. A candidate PASSES iff it withholds ≥ 1 item over the 55 AND mean p@8 on the 31 is ≥ 0.3952. The arm PASSES iff at least one A-pre candidate passes. `exactness: lower-bound` marks an A-pre/B candidate whose τ falls below some query-partition’s recorded `worstRelevance`, where an unrecorded 61st-plus vector hit could have backfilled the window.

## Control

Baseline re-derived from `arms.baseline` + labels on the 31 issue-anchored queries: mean p@8 0.3952, p@5-spec 0.1097, p@3-code 0.8710 — recorded in `r1-score.json` as 0.3952 / 0.1097 / 0.8710. Match: yes. Topic baseline (24 queries): 0.3750 / 0.1333 / 0.7778.

Calibrated points from the borderline set (the 410 labelled delivered baseline items carrying a relevance, over all 55): τ_cal2 = 0.5287 (min relevance over label-2 items − 0.0005), τ_cal1 = 0.5272 (the same over label ≥ 1).

## A-post (post-fusion withholding, the MCP `min_relevance` shape)

| candidate | tau | withheld (55) | 0 / 1 / 2 / unlab | withheld (31) | refusals | mean p@8 | Δ p@8 | p@5 spec | p@3 code | exactness | passes |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| tau=0.500 | 0.5000 | 0 | 0 / 0 / 0 / 0 | 0 | 0 | 0.3952 | +0.0000 | 0.1097 | 0.8710 | exact | no |
| tau=0.505 | 0.5050 | 0 | 0 / 0 / 0 / 0 | 0 | 0 | 0.3952 | +0.0000 | 0.1097 | 0.8710 | exact | no |
| tau=0.510 | 0.5100 | 1 | 1 / 0 / 0 / 0 | 0 | 0 | 0.3952 | +0.0000 | 0.1097 | 0.8710 | exact | PASS |
| tau=0.515 | 0.5150 | 2 | 2 / 0 / 0 / 0 | 0 | 0 | 0.3952 | +0.0000 | 0.1097 | 0.8710 | exact | PASS |
| tau=0.520 | 0.5200 | 5 | 5 / 0 / 0 / 0 | 0 | 0 | 0.3952 | +0.0000 | 0.1097 | 0.8710 | exact | PASS |
| tau=0.525 | 0.5250 | 8 | 8 / 0 / 0 / 0 | 0 | 0 | 0.3952 | +0.0000 | 0.1097 | 0.8710 | exact | PASS |
| tau=0.530 | 0.5300 | 13 | 11 / 1 / 1 / 0 | 0 | 0 | 0.3952 | +0.0000 | 0.1097 | 0.8710 | exact | PASS |
| tau=0.535 | 0.5350 | 15 | 13 / 1 / 1 / 0 | 0 | 0 | 0.3952 | +0.0000 | 0.1097 | 0.8710 | exact | PASS |
| tau=0.540 | 0.5400 | 17 | 15 / 1 / 1 / 0 | 0 | 0 | 0.3952 | +0.0000 | 0.1097 | 0.8710 | exact | PASS |
| tau=0.545 | 0.5450 | 20 | 16 / 1 / 3 / 0 | 0 | 0 | 0.3952 | +0.0000 | 0.1097 | 0.8710 | exact | PASS |
| tau=0.550 | 0.5500 | 28 | 21 / 3 / 4 / 0 | 0 | 0 | 0.3952 | +0.0000 | 0.1097 | 0.8710 | exact | PASS |
| tau=0.555 | 0.5550 | 33 | 24 / 5 / 4 / 0 | 0 | 0 | 0.3952 | +0.0000 | 0.1097 | 0.8710 | exact | PASS |
| tau=0.560 | 0.5600 | 39 | 28 / 6 / 5 / 0 | 1 | 0 | 0.3975 | +0.0023 | 0.1113 | 0.8710 | exact | PASS |
| tau=0.565 | 0.5650 | 56 | 35 / 10 / 11 / 0 | 3 | 0 | 0.3984 | +0.0032 | 0.1032 | 0.8710 | exact | PASS |
| tau=0.570 | 0.5700 | 62 | 38 / 10 / 14 / 0 | 3 | 1 | 0.3984 | +0.0032 | 0.1032 | 0.8710 | exact | PASS |
| tau=0.575 | 0.5750 | 75 | 46 / 11 / 18 / 0 | 6 | 1 | 0.4041 | +0.0090 | 0.1032 | 0.8710 | exact | PASS |
| tau=0.580 | 0.5800 | 83 | 51 / 14 / 18 / 0 | 9 | 1 | 0.4086 | +0.0134 | 0.1065 | 0.8710 | exact | PASS |
| tau=0.585 | 0.5850 | 99 | 63 / 16 / 20 / 0 | 14 | 1 | 0.4218 | +0.0266 | 0.1118 | 0.8710 | exact | PASS |
| tau=0.590 | 0.5900 | 115 | 74 / 19 / 22 / 0 | 22 | 1 | 0.4481 | +0.0530 | 0.1124 | 0.8710 | exact | PASS |
| tau=0.595 | 0.5950 | 132 | 84 / 23 / 25 / 0 | 29 | 1 | 0.4635 | +0.0683 | 0.1301 | 0.8710 | exact | PASS |
| tau=0.600 | 0.6000 | 147 | 92 / 25 / 30 / 0 | 37 | 1 | 0.4741 | +0.0790 | 0.1091 | 0.8710 | exact | PASS |
| tau=0.605 | 0.6050 | 164 | 104 / 28 / 32 / 0 | 47 | 1 | 0.5123 | +0.1171 | 0.1296 | 0.8710 | exact | PASS |
| tau=0.610 | 0.6100 | 176 | 114 / 28 / 34 / 0 | 53 | 1 | 0.5336 | +0.1384 | 0.1473 | 0.8710 | exact | PASS |
| tau=0.615 | 0.6150 | 192 | 122 / 34 / 36 / 0 | 65 | 1 | 0.5714 | +0.1763 | 0.1613 | 0.8710 | exact | PASS |
| tau=0.620 | 0.6200 | 208 | 133 / 39 / 36 / 0 | 77 | 1 | 0.6089 | +0.2138 | 0.1828 | 0.8710 | exact | PASS |
| tau=0.625 | 0.6250 | 228 | 146 / 43 / 39 / 0 | 93 | 1 | 0.6629 | +0.2678 | 0.2414 | 0.8710 | exact | PASS |
| tau=0.630 | 0.6300 | 243 | 155 / 45 / 43 / 0 | 104 | 1 | 0.6858 | +0.2906 | 0.2575 | 0.8656 | exact | PASS |
| tau=0.635 | 0.6350 | 256 | 160 / 47 / 49 / 0 | 115 | 1 | 0.7214 | +0.3262 | 0.1774 | 0.8817 | exact | PASS |
| tau=0.640 | 0.6400 | 271 | 168 / 50 / 53 / 0 | 127 | 2 | 0.7333 | +0.3382 | 0.2097 | 0.8495 | exact | PASS |
| tau=0.645 | 0.6450 | 283 | 174 / 54 / 55 / 0 | 136 | 2 | 0.7802 | +0.3850 | 0.2581 | 0.8656 | exact | PASS |
| tau=0.650 | 0.6500 | 293 | 178 / 58 / 57 / 0 | 142 | 2 | 0.8022 | +0.4071 | 0.2581 | 0.8710 | exact | PASS |
| tau=0.655 | 0.6550 | 299 | 178 / 59 / 62 / 0 | 146 | 3 | 0.8162 | +0.4210 | 0.2258 | 0.8817 | exact | PASS |
| tau=0.660 | 0.6600 | 307 | 181 / 60 / 66 / 0 | 152 | 4 | 0.7974 | +0.4022 | 0.2258 | 0.8495 | exact | PASS |
| tau=0.665 | 0.6650 | 322 | 182 / 60 / 80 / 0 | 164 | 6 | 0.8028 | +0.4076 | 0.1290 | 0.8172 | exact | PASS |
| tau=0.670 | 0.6700 | 330 | 183 / 62 / 85 / 0 | 172 | 7 | 0.7710 | +0.3758 | 0.1290 | 0.7796 | exact | PASS |
| tau=0.675 | 0.6750 | 337 | 184 / 63 / 90 / 0 | 178 | 7 | 0.7844 | +0.3892 | 0.1290 | 0.8011 | exact | PASS |
| tau=0.680 | 0.6800 | 345 | 184 / 64 / 97 / 0 | 186 | 8 | 0.7253 | +0.3301 | 0.0968 | 0.7473 | exact | PASS |
| tau=0.685 | 0.6850 | 352 | 185 / 64 / 103 / 0 | 193 | 8 | 0.7285 | +0.3333 | 0.0968 | 0.7473 | exact | PASS |
| tau=0.690 | 0.6900 | 356 | 186 / 64 / 106 / 0 | 195 | 9 | 0.7016 | +0.3065 | 0.0968 | 0.7151 | exact | PASS |
| tau=0.695 | 0.6950 | 365 | 186 / 65 / 114 / 0 | 203 | 11 | 0.6478 | +0.2527 | 0.0645 | 0.6613 | exact | PASS |
| tau=0.700 | 0.7000 | 372 | 186 / 65 / 121 / 0 | 209 | 12 | 0.6075 | +0.2124 | 0.0645 | 0.6290 | exact | PASS |
| tau=0.705 | 0.7050 | 378 | 186 / 65 / 127 / 0 | 214 | 14 | 0.5323 | +0.1371 | 0.0645 | 0.5484 | exact | PASS |
| tau=0.710 | 0.7100 | 381 | 186 / 65 / 130 / 0 | 216 | 15 | 0.5000 | +0.1048 | 0.0645 | 0.5161 | exact | PASS |
| tau=0.715 | 0.7150 | 384 | 186 / 65 / 133 / 0 | 218 | 17 | 0.4516 | +0.0565 | 0.0645 | 0.4516 | exact | PASS |
| tau=0.720 | 0.7200 | 394 | 186 / 65 / 143 / 0 | 225 | 21 | 0.3871 | -0.0081 | 0.0645 | 0.3548 | exact | no |
| tau=0.725 | 0.7250 | 397 | 186 / 65 / 146 / 0 | 227 | 23 | 0.3226 | -0.0726 | 0.0645 | 0.2903 | exact | no |
| tau=0.730 | 0.7300 | 399 | 186 / 65 / 148 / 0 | 227 | 24 | 0.3226 | -0.0726 | 0.0645 | 0.2903 | exact | no |
| tau=0.735 | 0.7350 | 403 | 186 / 65 / 152 / 0 | 231 | 26 | 0.2581 | -0.1371 | 0.0645 | 0.2258 | exact | no |
| tau=0.740 | 0.7400 | 405 | 186 / 65 / 154 / 0 | 232 | 27 | 0.2581 | -0.1371 | 0.0645 | 0.2258 | exact | no |
| tau=0.745 | 0.7450 | 406 | 186 / 65 / 155 / 0 | 233 | 27 | 0.2581 | -0.1371 | 0.0645 | 0.1935 | exact | no |
| tau=0.750 | 0.7500 | 408 | 186 / 65 / 157 / 0 | 235 | 28 | 0.2258 | -0.1694 | 0.0323 | 0.1935 | exact | no |
| tau_cal2 | 0.5287 | 11 | 10 / 1 / 0 / 0 | 0 | 0 | 0.3952 | +0.0000 | 0.1097 | 0.8710 | exact | PASS |
| tau_cal1 | 0.5272 | 9 | 9 / 0 / 0 / 0 | 0 | 0 | 0.3952 | +0.0000 | 0.1097 | 0.8710 | exact | PASS |

## A-pre (pre-fusion removal, the `distanceRange` shape)

| candidate | tau | withheld (55) | 0 / 1 / 2 / unlab | withheld (31) | refusals | mean p@8 | Δ p@8 | p@5 spec | p@3 code | exactness | passes |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| tau=0.500 | 0.5000 | 31 | 23 / 5 / 3 / 0 | 20 | 0 | 0.3911 | -0.0040 | 0.1032 | 0.8710 | lower-bound | no |
| tau=0.505 | 0.5050 | 31 | 23 / 5 / 3 / 0 | 20 | 0 | 0.3911 | -0.0040 | 0.1032 | 0.8710 | lower-bound | no |
| tau=0.510 | 0.5100 | 31 | 23 / 5 / 3 / 0 | 20 | 0 | 0.3911 | -0.0040 | 0.1032 | 0.8710 | lower-bound | no |
| tau=0.515 | 0.5150 | 32 | 24 / 5 / 3 / 0 | 20 | 0 | 0.3911 | -0.0040 | 0.1032 | 0.8710 | lower-bound | no |
| tau=0.520 | 0.5200 | 34 | 26 / 5 / 3 / 0 | 20 | 0 | 0.3911 | -0.0040 | 0.1032 | 0.8710 | lower-bound | no |
| tau=0.525 | 0.5250 | 37 | 29 / 5 / 3 / 0 | 20 | 0 | 0.3911 | -0.0040 | 0.1032 | 0.8710 | lower-bound | no |
| tau=0.530 | 0.5300 | 40 | 32 / 5 / 3 / 0 | 20 | 0 | 0.3911 | -0.0040 | 0.1032 | 0.8710 | lower-bound | no |
| tau=0.535 | 0.5350 | 42 | 34 / 5 / 3 / 0 | 20 | 0 | 0.3911 | -0.0040 | 0.1032 | 0.8710 | lower-bound | no |
| tau=0.540 | 0.5400 | 44 | 36 / 5 / 3 / 0 | 20 | 0 | 0.3911 | -0.0040 | 0.1032 | 0.8710 | lower-bound | no |
| tau=0.545 | 0.5450 | 47 | 37 / 5 / 5 / 0 | 20 | 0 | 0.3911 | -0.0040 | 0.1032 | 0.8710 | lower-bound | no |
| tau=0.550 | 0.5500 | 53 | 40 / 7 / 6 / 0 | 20 | 0 | 0.3911 | -0.0040 | 0.1032 | 0.8710 | lower-bound | no |
| tau=0.555 | 0.5550 | 56 | 41 / 9 / 6 / 0 | 20 | 0 | 0.3911 | -0.0040 | 0.1032 | 0.8710 | lower-bound | no |
| tau=0.560 | 0.5600 | 60 | 44 / 10 / 6 / 0 | 20 | 0 | 0.3911 | -0.0040 | 0.1032 | 0.8710 | lower-bound | no |
| tau=0.565 | 0.5650 | 68 | 48 / 11 / 9 / 0 | 22 | 0 | 0.3871 | -0.0081 | 0.0968 | 0.8710 | lower-bound | no |
| tau=0.570 | 0.5700 | 71 | 50 / 10 / 11 / 0 | 22 | 1 | 0.3831 | -0.0121 | 0.0903 | 0.8710 | lower-bound | no |
| tau=0.575 | 0.5750 | 77 | 55 / 10 / 12 / 0 | 23 | 1 | 0.3831 | -0.0121 | 0.0903 | 0.8710 | lower-bound | no |
| tau=0.580 | 0.5800 | 80 | 58 / 10 / 12 / 0 | 25 | 1 | 0.3831 | -0.0121 | 0.0903 | 0.8710 | lower-bound | no |
| tau=0.585 | 0.5850 | 91 | 67 / 11 / 13 / 0 | 29 | 1 | 0.3831 | -0.0121 | 0.0903 | 0.8710 | lower-bound | no |
| tau=0.590 | 0.5900 | 104 | 75 / 14 / 15 / 0 | 34 | 1 | 0.3831 | -0.0121 | 0.0903 | 0.8710 | lower-bound | no |
| tau=0.595 | 0.5950 | 111 | 80 / 15 / 16 / 0 | 37 | 1 | 0.3831 | -0.0121 | 0.0903 | 0.8710 | lower-bound | no |
| tau=0.600 | 0.6000 | 121 | 85 / 17 / 19 / 0 | 41 | 1 | 0.3871 | -0.0081 | 0.0968 | 0.8710 | lower-bound | no |
| tau=0.605 | 0.6050 | 135 | 96 / 20 / 19 / 0 | 51 | 1 | 0.3871 | -0.0081 | 0.0968 | 0.8710 | lower-bound | no |
| tau=0.610 | 0.6100 | 144 | 104 / 20 / 20 / 0 | 55 | 1 | 0.3911 | -0.0040 | 0.1032 | 0.8710 | lower-bound | no |
| tau=0.615 | 0.6150 | 158 | 110 / 24 / 24 / 0 | 65 | 1 | 0.3911 | -0.0040 | 0.1032 | 0.8710 | lower-bound | no |
| tau=0.620 | 0.6200 | 168 | 116 / 28 / 24 / 0 | 71 | 1 | 0.3871 | -0.0081 | 0.0968 | 0.8710 | lower-bound | no |
| tau=0.625 | 0.6250 | 180 | 121 / 33 / 26 / 0 | 83 | 1 | 0.3871 | -0.0081 | 0.1032 | 0.8602 | lower-bound | no |
| tau=0.630 | 0.6300 | 190 | 127 / 34 / 29 / 0 | 92 | 1 | 0.3790 | -0.0161 | 0.0968 | 0.8495 | lower-bound | no |
| tau=0.635 | 0.6350 | 198 | 130 / 36 / 32 / 0 | 100 | 1 | 0.3710 | -0.0242 | 0.0774 | 0.8602 | lower-bound | no |
| tau=0.640 | 0.6400 | 204 | 135 / 38 / 31 / 0 | 107 | 1 | 0.3710 | -0.0242 | 0.0774 | 0.8602 | lower-bound | no |
| tau=0.645 | 0.6450 | 213 | 139 / 41 / 33 / 0 | 114 | 1 | 0.3790 | -0.0161 | 0.0839 | 0.8710 | lower-bound | no |
| tau=0.650 | 0.6500 | 221 | 143 / 44 / 34 / 0 | 120 | 1 | 0.3750 | -0.0202 | 0.0839 | 0.8602 | lower-bound | no |
| tau=0.655 | 0.6550 | 225 | 143 / 45 / 37 / 0 | 124 | 1 | 0.3589 | -0.0363 | 0.0710 | 0.8387 | lower-bound | no |
| tau=0.660 | 0.6600 | 227 | 142 / 46 / 39 / 0 | 125 | 1 | 0.3589 | -0.0363 | 0.0710 | 0.8387 | lower-bound | no |
| tau=0.665 | 0.6650 | 240 | 145 / 46 / 49 / 0 | 137 | 1 | 0.3347 | -0.0605 | 0.0516 | 0.8065 | lower-bound | no |
| tau=0.670 | 0.6700 | 245 | 144 / 48 / 53 / 0 | 142 | 1 | 0.3185 | -0.0766 | 0.0516 | 0.7634 | lower-bound | no |
| tau=0.675 | 0.6750 | 248 | 144 / 48 / 56 / 0 | 144 | 1 | 0.3105 | -0.0847 | 0.0516 | 0.7419 | lower-bound | no |
| tau=0.680 | 0.6800 | 249 | 144 / 48 / 57 / 0 | 145 | 1 | 0.3065 | -0.0887 | 0.0452 | 0.7419 | lower-bound | no |
| tau=0.685 | 0.6850 | 254 | 145 / 48 / 61 / 0 | 150 | 1 | 0.2984 | -0.0968 | 0.0452 | 0.7204 | lower-bound | no |
| tau=0.690 | 0.6900 | 256 | 147 / 47 / 62 / 0 | 150 | 1 | 0.2984 | -0.0968 | 0.0452 | 0.7204 | lower-bound | no |
| tau=0.695 | 0.6950 | 257 | 146 / 48 / 63 / 0 | 151 | 1 | 0.2944 | -0.1008 | 0.0387 | 0.7204 | lower-bound | no |
| tau=0.700 | 0.7000 | 261 | 146 / 48 / 67 / 0 | 155 | 1 | 0.2863 | -0.1089 | 0.0323 | 0.7097 | exact | no |
| tau=0.705 | 0.7050 | 263 | 146 / 47 / 70 / 0 | 157 | 1 | 0.2742 | -0.1210 | 0.0323 | 0.6774 | exact | no |
| tau=0.710 | 0.7100 | 264 | 146 / 47 / 71 / 0 | 158 | 1 | 0.2661 | -0.1290 | 0.0258 | 0.6667 | exact | no |
| tau=0.715 | 0.7150 | 264 | 146 / 47 / 71 / 0 | 158 | 1 | 0.2661 | -0.1290 | 0.0194 | 0.6774 | exact | no |
| tau=0.720 | 0.7200 | 269 | 146 / 47 / 76 / 0 | 162 | 1 | 0.2460 | -0.1492 | 0.0194 | 0.6237 | exact | no |
| tau=0.725 | 0.7250 | 269 | 146 / 47 / 76 / 0 | 162 | 1 | 0.2460 | -0.1492 | 0.0194 | 0.6237 | exact | no |
| tau=0.730 | 0.7300 | 269 | 146 / 47 / 76 / 0 | 162 | 1 | 0.2460 | -0.1492 | 0.0194 | 0.6237 | exact | no |
| tau=0.735 | 0.7350 | 271 | 146 / 47 / 78 / 0 | 164 | 1 | 0.2379 | -0.1573 | 0.0194 | 0.6022 | exact | no |
| tau=0.740 | 0.7400 | 271 | 146 / 47 / 78 / 0 | 163 | 1 | 0.2419 | -0.1532 | 0.0194 | 0.6129 | exact | no |
| tau=0.745 | 0.7450 | 271 | 146 / 47 / 78 / 0 | 163 | 1 | 0.2419 | -0.1532 | 0.0194 | 0.6129 | exact | no |
| tau=0.750 | 0.7500 | 271 | 146 / 47 / 78 / 0 | 163 | 1 | 0.2419 | -0.1532 | 0.0194 | 0.6129 | exact | no |
| tau_cal2 | 0.5287 | 39 | 31 / 5 / 3 / 0 | 20 | 0 | 0.3911 | -0.0040 | 0.1032 | 0.8710 | lower-bound | no |
| tau_cal1 | 0.5272 | 38 | 30 / 5 / 3 / 0 | 20 | 0 | 0.3911 | -0.0040 | 0.1032 | 0.8710 | lower-bound | no |

## B (distribution-relative τ, A-pre shape)

| candidate | tau | withheld (55) | 0 / 1 / 2 / unlab | withheld (31) | refusals | mean p@8 | Δ p@8 | p@5 spec | p@3 code | exactness | passes |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| delta=0.02 | best_q − 0.02 | 231 | 142 / 41 / 48 / 0 | 145 | 0 | 0.2782 | -0.1169 | 0.0452 | 0.6667 | lower-bound | no |
| delta=0.05 | best_q − 0.05 | 164 | 119 / 29 / 16 / 0 | 119 | 0 | 0.3508 | -0.0444 | 0.0774 | 0.8065 | lower-bound | no |
| delta=0.10 | best_q − 0.10 | 93 | 71 / 15 / 7 / 0 | 64 | 0 | 0.3911 | -0.0040 | 0.1032 | 0.8710 | lower-bound | no |
| delta=0.15 | best_q − 0.15 | 31 | 22 / 6 / 3 / 0 | 22 | 0 | 0.3911 | -0.0040 | 0.1032 | 0.8710 | lower-bound | no |
| rho=0.05 | best_q × 0.95 | 199 | 133 / 36 / 30 / 0 | 129 | 0 | 0.3226 | -0.0726 | 0.0645 | 0.7527 | lower-bound | no |
| rho=0.10 | best_q × 0.90 | 144 | 106 / 26 / 12 / 0 | 103 | 0 | 0.3710 | -0.0242 | 0.0903 | 0.8387 | lower-bound | no |
| rho=0.15 | best_q × 0.85 | 76 | 60 / 10 / 6 / 0 | 48 | 0 | 0.3871 | -0.0081 | 0.0968 | 0.8710 | lower-bound | no |
| rho=0.20 | best_q × 0.80 | 32 | 23 / 6 / 3 / 0 | 22 | 0 | 0.3911 | -0.0040 | 0.1032 | 0.8710 | lower-bound | no |

## Verdict

R4 FAILS: no A-pre candidate withholds at least one delivered item over the 55 while holding mean p@8 on the 31 at or above 0.3952. Passing candidates (44 of 114): A-post tau=0.510, A-post tau=0.515, A-post tau=0.520, A-post tau=0.525, A-post tau=0.530, A-post tau=0.535, A-post tau=0.540, A-post tau=0.545, A-post tau=0.550, A-post tau=0.555, A-post tau=0.560, A-post tau=0.565, A-post tau=0.570, A-post tau=0.575, A-post tau=0.580, A-post tau=0.585, A-post tau=0.590, A-post tau=0.595, A-post tau=0.600, A-post tau=0.605, A-post tau=0.610, A-post tau=0.615, A-post tau=0.620, A-post tau=0.625, A-post tau=0.630, A-post tau=0.635, A-post tau=0.640, A-post tau=0.645, A-post tau=0.650, A-post tau=0.655, A-post tau=0.660, A-post tau=0.665, A-post tau=0.670, A-post tau=0.675, A-post tau=0.680, A-post tau=0.685, A-post tau=0.690, A-post tau=0.695, A-post tau=0.700, A-post tau=0.705, A-post tau=0.710, A-post tau=0.715, A-post tau_cal2, A-post tau_cal1. Among the 8 candidates that withhold no label-2 item, the one withholding the most is A-post tau_cal2 (11 items over the 55; 10 label-0, 1 label-1; mean p@8 0.3952, Δ +0.0000; refusals 0; exact).

## Limits

One profile (gemini-embedding-2-preview, 768-d, squared-L2 distance, relevance = 1/(1+_distance)). Labels cover only the delivered sets and pools R1 labelled (814 pairs); an unlabelled item is a non-hit, as in R1. The pool is the recorded retrieval window — 60 vector hits per spec leg, 9 per code leg — so no re-embedding and no backfill beyond it. Topic queries are unscored against the falsifier. The arm measures the floor as a withholding device, not the refusal envelope’s wording.
