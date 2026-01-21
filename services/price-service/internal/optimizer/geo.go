package optimizer

import (
	"math"
	"sort"
)

// HaversineKm calculates the great-circle distance between two points in kilometers.
func HaversineKm(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371.0 // Earth radius km
	dLat := toRad(lat2 - lat1)
	dLon := toRad(lon2 - lon1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(toRad(lat1))*math.Cos(toRad(lat2))*
			math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return R * c
}

func toRad(deg float64) float64 {
	return deg * math.Pi / 180
}

// SortStoresByDistance sorts a slice of StoreWithDistance in place.
func SortStoresByDistance(stores []StoreWithDistance) {
	sort.Slice(stores, func(i, j int) bool {
		return stores[i].Distance < stores[j].Distance
	})
}
