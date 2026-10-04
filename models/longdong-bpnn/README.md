# Longdong BPNN model export

This package contains the already-trained BPNN models used for the original 47 raw-data run. No retraining or post-processing was performed during export.

## Model architecture

- Model: plain feed-forward BPNN
- Architecture: 192 inputs -> 8 hidden neurons -> 1 output
- Hidden activation: ReLU
- Optimizer: momentum SGD, momentum 0.9
- Loss: MSE
- Input window: 24 hourly steps
- Input features per hour: 8
- Flattened input size: 24 x 8 = 192
- Training: 800 epochs, learning rate 0.001, batch size 32
- Ensemble: 5 independently trained runs are included

## Input feature order

Each 24-hour input window must use this exact feature order at every hour:

1. `surgeC_cm`
2. `pressure_hpa`
3. `wind_m_s`
4. `distance_km`
5. `track_dx_deg`
6. `track_dy_deg`
7. `water_cm`
8. `tide_cm`

The `.npz` files contain the feature statistics, target statistics, temporal weights, layer sizes, and model weights needed for inference.

## Files

- `models/*_Single.npz`: one saved BPNN run for each lead time.
- `models/*_Ensemble5.npz`: five-run ensemble for each lead time; use these for the exported ensemble predictions.
- `metadata/BPNN_summary.json`: complete training configuration and event split.
- `metadata/metrics_lead*.json`: test metrics for each lead time.

Lead times included: +1 hour, +3 hours, and +6 hours.

The original test events were `200505`, `200813`, and `200815`; the training events and preprocessing settings are recorded in `BPNN_summary.json`.
