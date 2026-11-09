'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, Field, Select, StatusBadge } from '@/components/ui';
import { api, ApiError, call } from '@/lib/api';

type Property = { id: string; name: string; city: string };
const PERKS = [
  'breakfast',
  'upgrade',
  'credit',
  'early_check_in',
  'late_check_out',
  'amenity',
  'other',
] as const;

/** FR-PRT-01: suppliers and preferred partner programs; FR-INV-01: refresh hotel content. */
export default function PartnersPage() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picked, setPicked] = useState<Property[]>([]);
  const [found, setFound] = useState<Property[]>([]);
  const [perks, setPerks] = useState<Array<{ kind: (typeof PERKS)[number]; description: string }>>([
    { kind: 'breakfast', description: '' },
  ]);
  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => call(api.GET('/v1/admin/partners/suppliers')),
  });
  const programs = useQuery({
    queryKey: ['programs'],
    queryFn: () => call(api.GET('/v1/admin/partners/programs')),
  });
  const onError = (e: unknown) =>
    setError(e instanceof ApiError ? e.message : 'Something went wrong');

  const ingest = useMutation({
    mutationFn: () => call(api.POST('/v1/admin/catalog/ingest')),
    onSuccess: (r) => setNotice(`Content refresh queued for ${r.suppliers.join(', ')}.`),
    onError,
  });
  const toggle = useMutation({
    mutationFn: (p: { id: string; version: number; active: boolean }) =>
      call(
        api.PATCH('/v1/admin/partners/programs/{id}', {
          params: { path: { id: p.id } },
          body: { version: p.version, active: !p.active },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['programs'] }),
    onError,
  });

  async function addSupplier(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await call(
        api.POST('/v1/admin/partners/suppliers', {
          body: { name: String(f.get('name')), type: String(f.get('type')) as 'hotel_group' },
        }),
      );
      form.reset();
      await qc.invalidateQueries({ queryKey: ['suppliers'] });
    } catch (err) {
      onError(err);
    }
  }

  async function findProperties(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get('q') ?? '').trim();
    if (q.length < 2) return;
    setFound(await call(api.GET('/v1/admin/catalog/properties', { params: { query: { q } } })));
  }

  async function addProgram(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const f = new FormData(form);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    try {
      await call(
        api.POST('/v1/admin/partners/programs', {
          body: {
            supplierId: s('supplierId'),
            name: s('name'),
            tier: s('tier') as 'preferred',
            perks: perks.filter((p) => p.description.trim().length >= 2),
            rateCodes: s('rateCodes')
              ? s('rateCodes')
                  .split(',')
                  .map((x) => x.trim().toUpperCase())
              : [],
            propertyIds: picked.map((p) => p.id),
          },
        }),
      );
      form.reset();
      setPicked([]);
      setPerks([{ kind: 'breakfast', description: '' }]);
      setNotice('Program created. Search marks its hotels as preferred within a few seconds.');
      await qc.invalidateQueries({ queryKey: ['programs'] });
    } catch (err) {
      onError(err);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-normal tracking-tight">Partners</h1>
        <Button variant="secondary" onClick={() => ingest.mutate()}>
          Refresh hotel content
        </Button>
      </div>
      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <Card title="Programs">
        <ul className="flex flex-col divide-y divide-line text-sm">
          {programs.data?.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <strong>{p.name}</strong> · {p.supplierName} · {p.tier} · {p.propertyIds.length}{' '}
                hotels · {p.perks.map((x) => x.description).join(', ')}
              </span>
              <span className="flex items-center gap-2">
                <StatusBadge status={p.effective ? 'active' : 'inactive'} />
                <Button variant="secondary" onClick={() => toggle.mutate(p)}>
                  {p.active ? 'Deactivate' : 'Activate'}
                </Button>
              </span>
            </li>
          ))}
          {programs.data?.length === 0 && <li className="py-2 text-muted">No programs yet</li>}
        </ul>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="New program">
          <form onSubmit={findProperties} className="mb-4 flex items-end gap-2">
            <div className="flex-1">
              <Field label="Find hotels" name="q" placeholder="Name or city" />
            </div>
            <Button type="submit" variant="secondary">
              Find
            </Button>
          </form>
          {found.length > 0 && (
            <ul className="mb-4 max-h-48 overflow-y-auto text-sm">
              {found.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-1">
                  <span>
                    {p.name} <span className="text-muted">({p.city})</span>
                  </span>
                  <button
                    className="text-brand-700 underline"
                    onClick={() =>
                      setPicked(picked.some((x) => x.id === p.id) ? picked : [...picked, p])
                    }
                  >
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addProgram} className="flex flex-col gap-3">
            <p className="text-sm">
              Hotels:{' '}
              {picked.length ? (
                picked.map((p) => p.name).join(', ')
              ) : (
                <span className="text-muted">none yet</span>
              )}
            </p>
            <Select label="Supplier" name="supplierId">
              {suppliers.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Field label="Program name" name="name" required />
            <Select label="Tier" name="tier">
              <option value="preferred">Preferred</option>
              <option value="luxury">Luxury</option>
              <option value="exclusive">Exclusive</option>
            </Select>
            <Field
              label="Eligible rate codes"
              name="rateCodes"
              placeholder="ADV"
              hint="Comma separated. Empty: every rate at these hotels gets the perks."
            />
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Perks</legend>
              {perks.map((p, i) => (
                <div key={i} className="grid grid-cols-[140px_1fr] gap-2">
                  <select
                    aria-label="Perk type"
                    className="rounded-[18px] bg-canvas px-3 outline-none focus:ring-2 focus:ring-accent"
                    value={p.kind}
                    onChange={(e) =>
                      setPerks(
                        perks.map((x, j) =>
                          j === i ? { ...x, kind: e.target.value as typeof p.kind } : x,
                        ),
                      )
                    }
                  >
                    {PERKS.map((k) => (
                      <option key={k} value={k}>
                        {k.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Perk description"
                    className="rounded-[18px] bg-canvas px-4 py-3 outline-none focus:ring-2 focus:ring-accent"
                    value={p.description}
                    onChange={(e) =>
                      setPerks(
                        perks.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)),
                      )
                    }
                    placeholder="Daily breakfast for two"
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                className="self-start"
                onClick={() => setPerks([...perks, { kind: 'other', description: '' }])}
              >
                Add perk
              </Button>
            </fieldset>
            <Button type="submit" disabled={picked.length === 0}>
              Create program
            </Button>
          </form>
        </Card>
        <Card title="Suppliers">
          <ul className="mb-4 text-sm">
            {suppliers.data?.map((s) => (
              <li key={s.id}>
                {s.name} <span className="text-muted">({s.type.replace('_', ' ')})</span>
              </li>
            ))}
          </ul>
          <form onSubmit={addSupplier} className="flex flex-col gap-3">
            <Field label="Supplier name" name="name" required />
            <Select label="Type" name="type">
              <option value="hotel_group">Hotel group</option>
              <option value="hotel">Hotel</option>
              <option value="cruise_line">Cruise line</option>
              <option value="tour_operator">Tour operator</option>
            </Select>
            <Button type="submit" variant="secondary">
              Add supplier
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
