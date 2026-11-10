import { describe, expect, it } from 'vitest';
import { distanceMetres, findMatch, nameSimilarity, normalizeName } from './matching.js';

describe('property matching (FR-INV-02)', () => {
  it('normalises names', () => {
    expect(normalizeName('The Palm & Pine Lisbon Hotel')).toBe('palm pine lisbon');
    expect(normalizeName('Hôtel Café Ritz')).toBe('cafe ritz');
  });

  it('scores the same hotel written differently as similar', () => {
    expect(
      nameSimilarity('Palm & Pine Lisbon Suites', 'The Palm and Pine Lisbon Suites'),
    ).toBeGreaterThan(0.9);
    expect(nameSimilarity('Harbourline Paris Inn', 'Northlight Paris Residences')).toBeLessThan(
      0.4,
    );
  });

  it('measures distance', () => {
    expect(Math.round(distanceMetres(38.7223, -9.1393, 38.7226, -9.1395))).toBeGreaterThan(30);
    expect(distanceMetres(38.7223, -9.1393, 38.7226, -9.1395)).toBeLessThan(60);
  });

  const existing = [
    { id: 'p1', name: 'Palm & Pine Lisbon Suites', lat: 38.72, lng: -9.14, sharedId: null },
    { id: 'p2', name: 'Harbourline Lisbon Inn', lat: 38.73, lng: -9.15, sharedId: 'G-2' },
  ];

  it('matches on shared identifier wherever the coordinates are', () => {
    expect(
      findMatch({ name: 'Totally different', lat: 0, lng: 0, sharedId: 'G-2' }, existing),
    ).toEqual({ id: 'p2', reason: 'shared_id' });
  });

  it('matches on nearby location plus similar name', () => {
    expect(
      findMatch(
        { name: 'The Palm and Pine Lisbon Suites', lat: 38.7203, lng: -9.1402, sharedId: null },
        existing,
      ),
    ).toEqual({ id: 'p1', reason: 'location_and_name' });
  });

  it('does not match a similar name far away, or a different hotel next door', () => {
    expect(
      findMatch(
        { name: 'Palm & Pine Lisbon Suites', lat: 38.8, lng: -9.14, sharedId: null },
        existing,
      ),
    ).toBeNull();
    expect(
      findMatch(
        { name: 'Casa Verde Lisbon House', lat: 38.7201, lng: -9.1401, sharedId: null },
        existing,
      ),
    ).toBeNull();
  });

  it('never merges two hotels with different shared identifiers', () => {
    expect(
      findMatch(
        { name: 'Harbourline Lisbon Inn', lat: 38.73, lng: -9.15, sharedId: 'G-9' },
        existing,
      ),
    ).toBeNull();
  });
});
