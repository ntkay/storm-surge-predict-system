"""Train the Suao CNN-LSTM with Sinlaku withheld as the only test event."""
from train_cnn_lstm import STATIONS, main

STATIONS["suao"]["tests"] = ["2008Sinlaku s"]
STATIONS.pop("longdong")
main()
