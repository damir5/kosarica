package config

import (
	"github.com/kosarica/price-service/internal/parsers/csv"
	"github.com/kosarica/price-service/internal/types"
)

// ChainID represents unique identifier for each retail chain
type ChainID string

const (
	ChainKonzum    ChainID = "konzum"
	ChainLidl      ChainID = "lidl"
	ChainPlodine   ChainID = "plodine"
	ChainInterspar ChainID = "interspar"
	ChainStudenac  ChainID = "studenac"
	ChainKaufland  ChainID = "kaufland"
	ChainEurospin  ChainID = "eurospin"
	ChainDm        ChainID = "dm"
	ChainKtc       ChainID = "ktc"
	ChainMetro     ChainID = "metro"
	ChainTrgocentar ChainID = "trgocentar"
)

// ChainIDs contains all valid chain IDs
var ChainIDs = []ChainID{
	ChainKonzum,
	ChainLidl,
	ChainPlodine,
	ChainInterspar,
	ChainStudenac,
	ChainKaufland,
	ChainEurospin,
	ChainDm,
	ChainKtc,
	ChainMetro,
	ChainTrgocentar,
}

// CSVConfig contains CSV-specific configuration
type CSVConfig struct {
	Delimiter csv.CsvDelimiter `json:"delimiter"`
	Encoding  csv.CsvEncoding  `json:"encoding"`
	HasHeader bool             `json:"hasHeader"`
}

// ChainConfig contains configuration for a retail chain's data source
type ChainConfig struct {
	ID               ChainID            `json:"id"`
	Name             string             `json:"name"`
	BaseURL          string             `json:"baseUrl"`
	PrimaryFileType  types.FileType     `json:"primaryFileType"`
	SupportedTypes   []types.FileType   `json:"supportedFileTypes"`
	CSV              *CSVConfig         `json:"csv,omitempty"`
	UsesZIP          bool               `json:"usesZip"`
	StoreResolution  string             `json:"storeResolution"` // "filename", "portal_id", "national"
	Metadata         map[string]string  `json:"metadata,omitempty"`
}

// ChainConfigs contains all chain configurations
var ChainConfigs = map[ChainID]ChainConfig{
	ChainKonzum: {
		ID:              ChainKonzum,
		Name:            "Konzum",
		BaseURL:         "https://www.konzum.hr/cjenici",
		PrimaryFileType: types.FileTypeCSV,
		SupportedTypes:  []types.FileType{types.FileTypeCSV},
		CSV: &CSVConfig{
			Delimiter: csv.DelimiterComma,
			Encoding:  csv.EncodingUTF8,
			HasHeader: true,
		},
		UsesZIP:         false,
		StoreResolution: "filename",
	},
	ChainLidl: {
		ID:              ChainLidl,
		Name:            "Lidl",
		BaseURL:         "https://tvrtka.lidl.hr/cijene",
		PrimaryFileType: types.FileTypeCSV,
		SupportedTypes:  []types.FileType{types.FileTypeCSV, types.FileTypeZIP},
		CSV: &CSVConfig{
			Delimiter: csv.DelimiterComma,
			Encoding:  csv.EncodingWindows1250,
			HasHeader: true,
		},
		UsesZIP:         true,
		StoreResolution: "filename",
	},
	ChainPlodine: {
		ID:              ChainPlodine,
		Name:            "Plodine",
		BaseURL:         "https://www.plodine.hr/info-o-cijenama",
		PrimaryFileType: types.FileTypeCSV,
		SupportedTypes:  []types.FileType{types.FileTypeCSV},
		CSV: &CSVConfig{
			Delimiter: csv.DelimiterSemicolon,
			Encoding:  csv.EncodingWindows1250,
			HasHeader: true,
		},
		UsesZIP:         false,
		StoreResolution: "filename",
	},
	ChainInterspar: {
		ID:              ChainInterspar,
		Name:            "Interspar",
		BaseURL:         "https://www.spar.hr/usluge/cjenici",
		PrimaryFileType: types.FileTypeCSV,
		SupportedTypes:  []types.FileType{types.FileTypeCSV},
		CSV: &CSVConfig{
			Delimiter: csv.DelimiterSemicolon,
			Encoding:  csv.EncodingUTF8,
			HasHeader: true,
		},
		UsesZIP:         false,
		StoreResolution: "filename",
	},
	ChainStudenac: {
		ID:              ChainStudenac,
		Name:            "Studenac",
		BaseURL:         "https://www.studenac.hr/popis-maloprodajnih-cijena",
		PrimaryFileType: types.FileTypeXML,
		SupportedTypes:  []types.FileType{types.FileTypeXML},
		CSV:             nil,
		UsesZIP:         false,
		StoreResolution: "portal_id",
	},
	ChainKaufland: {
		ID:              ChainKaufland,
		Name:            "Kaufland",
		BaseURL:         "https://www.kaufland.hr/akcije-novosti/popis-mpc.html",
		PrimaryFileType: types.FileTypeCSV,
		SupportedTypes:  []types.FileType{types.FileTypeCSV},
		CSV: &CSVConfig{
			Delimiter: csv.DelimiterTab,
			Encoding:  csv.EncodingUTF8,
			HasHeader: true,
		},
		UsesZIP:         false,
		StoreResolution: "filename",
	},
	ChainEurospin: {
		ID:              ChainEurospin,
		Name:            "Eurospin",
		BaseURL:         "https://www.eurospin.hr/cjenik/",
		PrimaryFileType: types.FileTypeCSV,
		SupportedTypes:  []types.FileType{types.FileTypeCSV, types.FileTypeZIP},
		CSV: &CSVConfig{
			Delimiter: csv.DelimiterSemicolon,
			Encoding:  csv.EncodingUTF8,
			HasHeader: true,
		},
		UsesZIP:         true,
		StoreResolution: "filename",
	},
	ChainDm: {
		ID:              ChainDm,
		Name:            "DM",
		BaseURL:         "https://www.dm.hr/novo/promocije/nove-oznake-cijena-i-vazeci-cjenik-u-dm-u-2906632",
		PrimaryFileType: types.FileTypeXLSX,
		SupportedTypes:  []types.FileType{types.FileTypeXLSX},
		CSV:             nil,
		UsesZIP:         false,
		StoreResolution: "national",
	},
	ChainKtc: {
		ID:              ChainKtc,
		Name:            "KTC",
		BaseURL:         "https://www.ktc.hr/cjenici",
		PrimaryFileType: types.FileTypeCSV,
		SupportedTypes:  []types.FileType{types.FileTypeCSV},
		CSV: &CSVConfig{
			Delimiter: csv.DelimiterSemicolon,
			Encoding:  csv.EncodingWindows1250,
			HasHeader: true,
		},
		UsesZIP:         false,
		StoreResolution: "filename",
	},
	ChainMetro: {
		ID:              ChainMetro,
		Name:            "Metro",
		BaseURL:         "https://metrocjenik.com.hr/",
		PrimaryFileType: types.FileTypeCSV,
		SupportedTypes:  []types.FileType{types.FileTypeCSV},
		CSV: &CSVConfig{
			Delimiter: csv.DelimiterComma,
			Encoding:  csv.EncodingUTF8,
			HasHeader: true,
		},
		UsesZIP:         false,
		StoreResolution: "portal_id",
	},
	ChainTrgocentar: {
		ID:              ChainTrgocentar,
		Name:            "Trgocentar",
		BaseURL:         "https://trgocentar.com/Trgovine-cjenik/",
		PrimaryFileType: types.FileTypeCSV,
		SupportedTypes:  []types.FileType{types.FileTypeCSV},
		CSV: &CSVConfig{
			Delimiter: csv.DelimiterSemicolon,
			Encoding:  csv.EncodingUTF8,
			HasHeader: true,
		},
		UsesZIP:         false,
		StoreResolution: "filename",
	},
}

// GetChainConfig returns the configuration for a chain
func GetChainConfig(chainID ChainID) (ChainConfig, bool) {
	config, ok := ChainConfigs[chainID]
	return config, ok
}

// IsValidChainID checks if a string is a valid chain ID
func IsValidChainID(value string) bool {
	for _, id := range ChainIDs {
		if string(id) == value {
			return true
		}
	}
	return false
}
