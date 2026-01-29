package handlers

import (
	"testing"

	"github.com/kosarica/price-service/internal/optimizer"
	"github.com/stretchr/testify/assert"
)

// TestHaversineEdgeCases tests Haversine calculation edge cases.
func TestHaversineEdgeCases(t *testing.T) {
	tests := []struct {
		name     string
		lat1     float64
		lon1     float64
		lat2     float64
		lon2     float64
		wantDist float64
	}{
		{
			name: "same point",
			lat1: 45.0, lon1: 16.0,
			lat2: 45.0, lon2: 16.0,
			wantDist: 0,
		},
		{
			name: "poles - north pole to south pole",
			lat1: 90.0, lon1: 0.0,
			lat2: -90.0, lon2: 0.0,
			wantDist: 20015, // Approximately half Earth's circumference
		},
		{
			name: "date line crossing",
			lat1: 0.0, lon1: 179.0,
			lat2: 0.0, lon2: -179.0,
			wantDist: 222, // About 2 degrees of longitude at equator
		},
		{
			name: "short distance",
			lat1: 45.0, lon1: 16.0,
			lat2: 45.1, lon2: 16.1,
			wantDist: 15, // Approximately 15km
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dist := optimizer.HaversineKm(tt.lat1, tt.lon1, tt.lat2, tt.lon2)
			// Allow 10% error margin for approximate distances
			assert.InDelta(t, tt.wantDist, dist, tt.wantDist*0.10)
		})
	}
}
