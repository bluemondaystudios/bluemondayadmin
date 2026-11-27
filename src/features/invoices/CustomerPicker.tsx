import { useMemo, useState } from 'react';
import { useCustomers } from '../../lib/api';
import type { Customer } from '../../lib/types';
import { Sheet } from '../../ui/Sheet';
import { Icon } from '../../ui/Icon';
import { CustomerForm } from '../customers/CustomerForm';

export function CustomerPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (c: Customer) => void }) {
  const q = useCustomers();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => {
    const t = search.trim().toLowerCase();
    return (q.data ?? []).filter((c) => !c.archived && (!t || [c.name, c.contact_person, c.phone].some((v) => v?.toLowerCase().includes(t))));
  }, [q.data, search]);

  const close = () => {
    setAdding(false);
    setSearch('');
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title={adding ? 'New client' : 'Choose client'}>
      {adding ? (
        <>
          <CustomerForm
            submitLabel="Save and use"
            onSaved={(c) => {
              onPick(c);
              close();
            }}
          />
          <button type="button" className="btn btn-link" onClick={() => setAdding(false)}>
            Back to the list
          </button>
        </>
      ) : (
        <>
          <button type="button" className="btn btn-secondary btn-block" onClick={() => setAdding(true)}>
            <Icon name="plus" size={20} /> New client
          </button>
          {(q.data?.length ?? 0) > 0 ? (
            <input className="input search" type="search" placeholder="Search clients" aria-label="Search clients" value={search} onChange={(e) => setSearch(e.target.value)} />
          ) : null}
          <ul className="list card sheet-list">
            {rows.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="list-row"
                  onClick={() => {
                    onPick(c);
                    close();
                  }}
                >
                  <span className="list-main">
                    <strong>{c.name}</strong>
                    <span className="muted small">{[c.contact_person, c.phone].filter(Boolean).join(' · ') || ' '}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {q.data && rows.length === 0 ? <p className="muted center">{search ? 'No match. Add them as a new client.' : 'No clients yet. Add one above.'}</p> : null}
        </>
      )}
    </Sheet>
  );
}
