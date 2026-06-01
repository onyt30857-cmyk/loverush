'use client';

/**
 * Google Places Autocomplete 输入框
 *
 * 用例:
 *   - 技师填服务地址(/t/me/profile)
 *   - 客户拍单填上门地址
 *
 * 设计:
 *   - 缺 NEXT_PUBLIC_GOOGLE_MAPS_API_KEY 时降级为普通 text input(仍能用)
 *   - 选中后调 onSelect 回传 { address, lat, lng, components }
 *   - 不入库精确坐标 · 由父组件决定是否保留(隐私由调用方控)
 *
 * 国家限制:
 *   - country prop 限制建议(如 'TH' / 'SG') · 不传则全球
 */

import { useEffect, useRef } from 'react';
import { useGoogleMaps } from '@/lib/use-google-maps';

export interface PlacesSelection {
  address: string;
  lat: number;
  lng: number;
  city: string | null;
  area: string | null;
  countryCode: string | null;
}

export interface PlacesAutocompleteInputProps {
  value: string;
  onChange: (v: string) => void;
  onSelect?: (selection: PlacesSelection) => void;
  placeholder?: string;
  /** ISO alpha-2 国家代码 · 限制搜索范围 · 不传则全球 */
  country?: string;
  className?: string;
  disabled?: boolean;
}

export function PlacesAutocompleteInput({
  value,
  onChange,
  onSelect,
  placeholder = '输入地址 · 自动联想',
  country,
  className,
  disabled,
}: PlacesAutocompleteInputProps) {
  const status = useGoogleMaps();
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<unknown>(null);

  useEffect(() => {
    if (status !== 'ready' || !inputRef.current || autocompleteRef.current) return;
    const g = window.google?.maps?.places;
    if (!g) return;

    const ac = new g.Autocomplete(inputRef.current, {
      fields: ['formatted_address', 'geometry.location', 'address_components'],
      ...(country ? { componentRestrictions: { country } } : {}),
      types: ['geocode'],
    });
    autocompleteRef.current = ac;

    ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      if (!place.geometry?.location || !place.formatted_address) return;
      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();
      const comps = place.address_components ?? [];
      const findByType = (t: string) => comps.find((c) => c.types.includes(t));
      onChange(place.formatted_address);
      if (onSelect) {
        onSelect({
          address: place.formatted_address,
          lat,
          lng,
          city: findByType('locality')?.long_name ?? findByType('administrative_area_level_1')?.long_name ?? null,
          area: findByType('sublocality')?.long_name ?? findByType('neighborhood')?.long_name ?? null,
          countryCode: findByType('country')?.short_name ?? null,
        });
      }
    });
    // cleanup on unmount
    return () => {
      autocompleteRef.current = null;
    };
  }, [status, country, onChange, onSelect]);

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={
        status === 'nokey' || status === 'error'
          ? `${placeholder} (手动输入)`
          : status === 'loading'
            ? '正在加载联想…'
            : placeholder
      }
      disabled={disabled}
      className={className ?? 'w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:bg-ink-50'}
      autoComplete="off"
    />
  );
}
