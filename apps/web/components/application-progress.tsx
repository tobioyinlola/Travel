'use client';

import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, CreditCard, FileSignature, GraduationCap, IdCard } from 'lucide-react';
import { api, call } from '@/lib/api';
import { ButtonLink, Card, ListRow, StatusBadge } from './ui';

/** Onboarding checklist for applicants and approved-but-not-active advisors (AC-01 steps). */
export function ApplicationProgress() {
  const app = useQuery({
    queryKey: ['application'],
    queryFn: async () => {
      const res = await api.GET('/v1/advisor-application');
      if (res.response.status === 404) return null;
      return call(Promise.resolve(res));
    },
    refetchInterval: 5000,
  });
  const membership = useQuery({
    queryKey: ['membership'],
    queryFn: async () => {
      const res = await api.GET('/v1/membership');
      if (res.response.status === 404) return null;
      return call(Promise.resolve(res));
    },
  });

  if (app.isPending) return <p className="text-muted">Loading…</p>;
  if (!app.data) {
    return (
      <Card>
        <h2 className="text-2xl font-normal">Start your advisor application</h2>
        <p className="mt-2 max-w-xl text-muted">
          Tell us about yourself, verify your identity and sign the contractor agreement. Most
          people finish in about 15 minutes.
        </p>
        <ButtonLink href="/application" className="mt-6">
          Start application
        </ButtonLink>
      </Card>
    );
  }
  const a = app.data;
  const m = membership.data;
  const steps = [
    { icon: IdCard, title: 'Application', status: 'passed', subtitle: 'Submitted' },
    {
      icon: BadgeCheck,
      title: 'Identity verification',
      status: a.kyc.status,
      subtitle: a.kyc.status === 'passed' ? 'Verified' : 'Verify with our partner',
    },
    {
      icon: FileSignature,
      title: 'Contractor agreement',
      status: a.agreement.status,
      subtitle:
        a.agreement.status === 'signed'
          ? `Signed, version ${a.agreement.version}`
          : 'Review and sign',
    },
    {
      icon: CreditCard,
      title: 'Membership',
      status: m?.status ?? 'pending',
      subtitle: m ? `${m.plan.name}` : 'Choose a plan',
    },
    {
      icon: GraduationCap,
      title: 'Essentials course',
      status: a.essentialsPassedAt ? 'passed' : 'pending',
      subtitle: a.essentialsPassedAt ? 'Passed' : 'Unlocks booking',
    },
  ];
  return (
    <Card title="Getting set up" action={<StatusBadge status={a.status} />}>
      <ul className="flex flex-col gap-2">
        {steps.map((s) => (
          <li key={s.title}>
            <ListRow
              icon={s.icon}
              title={s.title}
              subtitle={s.subtitle}
              href={s.title === 'Essentials course' ? '/learn/essentials' : '/application'}
              trailing={<StatusBadge status={s.status} />}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}
