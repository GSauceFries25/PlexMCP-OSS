"use client";

import { memo } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from "react-simple-maps";
import { Tooltip } from "react-tooltip";
import type { WebsiteLocationEntry } from "@/lib/api/client";

const geoUrl = "/world-110m.json";

// Country code to name mapping (ISO 3166-1 alpha-2)
const countryNames: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  DE: "Germany",
  FR: "France",
  CA: "Canada",
  AU: "Australia",
  JP: "Japan",
  CN: "China",
  IN: "India",
  BR: "Brazil",
  RU: "Russia",
  KR: "South Korea",
  IT: "Italy",
  ES: "Spain",
  MX: "Mexico",
  NL: "Netherlands",
  SE: "Sweden",
  CH: "Switzerland",
  PL: "Poland",
  NO: "Norway",
  DK: "Denmark",
  FI: "Finland",
  BE: "Belgium",
  AT: "Austria",
  NZ: "New Zealand",
  SG: "Singapore",
  HK: "Hong Kong",
  TW: "Taiwan",
  IE: "Ireland",
  PT: "Portugal",
  CZ: "Czech Republic",
  RO: "Romania",
  HU: "Hungary",
  IL: "Israel",
  UA: "Ukraine",
  GR: "Greece",
  AR: "Argentina",
  CL: "Chile",
  CO: "Colombia",
  ZA: "South Africa",
  MY: "Malaysia",
  PH: "Philippines",
  TH: "Thailand",
  ID: "Indonesia",
  VN: "Vietnam",
  PK: "Pakistan",
  BD: "Bangladesh",
  EG: "Egypt",
  NG: "Nigeria",
  AE: "United Arab Emirates",
  SA: "Saudi Arabia",
  TR: "Turkey",
};

interface WorldMapProps {
  locations: WebsiteLocationEntry[];
  className?: string;
}

function WorldMapComponent({ locations, className }: WorldMapProps) {
  // Create lookup map for visitor counts
  const visitorsByCountry = new Map(
    locations.map((loc) => [loc.country_code, loc])
  );

  // Calculate color scale based on visitor counts
  const maxVisitors = Math.max(...locations.map((l) => l.visitors), 1);

  const getColor = (countryCode: string): string => {
    const data = visitorsByCountry.get(countryCode);
    if (!data) return "hsl(var(--muted))";

    // Scale from light to dark based on visitor percentage
    const intensity = Math.min(data.visitors / maxVisitors, 1);
    const lightness = 70 - intensity * 40; // 70% -> 30% lightness
    return `hsl(220, 70%, ${lightness}%)`;
  };

  const getTooltipContent = (countryCode: string): string => {
    const data = visitorsByCountry.get(countryCode);
    const name = countryNames[countryCode] || countryCode;
    if (!data) return name;
    return `${name}: ${data.visitors.toLocaleString()} visitors (${data.percentage.toFixed(1)}%)`;
  };

  return (
    <div className={className}>
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{
          scale: 120,
          center: [0, 20],
        }}
        style={{ width: "100%", height: "100%" }}
      >
        <ZoomableGroup center={[0, 20]} zoom={1}>
          <Geographies geography={geoUrl}>
            {({ geographies }) =>
              geographies.map((geo) => {
                // Get ISO alpha-2 code from geography properties
                const countryCode = geo.properties.ISO_A2 || geo.id;
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    data-tooltip-id="map-tooltip"
                    data-tooltip-content={getTooltipContent(countryCode)}
                    fill={getColor(countryCode)}
                    stroke="hsl(var(--border))"
                    strokeWidth={0.5}
                    style={{
                      default: { outline: "none" },
                      hover: {
                        fill: "hsl(var(--primary))",
                        outline: "none",
                        cursor: "pointer",
                      },
                      pressed: { outline: "none" },
                    }}
                  />
                );
              })
            }
          </Geographies>
        </ZoomableGroup>
      </ComposableMap>
      <Tooltip id="map-tooltip" />
    </div>
  );
}

export const WorldMap = memo(WorldMapComponent);
