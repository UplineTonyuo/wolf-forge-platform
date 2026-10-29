// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,expect,it } from 'vitest';
import { WalletHistory } from '../components/account/billing/wallet-history';
type Transactions=Parameters<typeof WalletHistory>[0]['transactions'];
const transactions=[{id:'a',source:'invoice_payment',amount_cents:-5000,currency:'USD',balance_after_cents:10000,created_at:'2026-10-30T00:00:00Z',reason:'Synthetic invoice'},{id:'b',source:'adjustment',amount_cents:15000,currency:'USD',balance_after_cents:15000,created_at:'2026-10-29T00:00:00Z',reason:'Synthetic credit'}] as Transactions;
afterEach(cleanup);
it('filters only the received transactions and preserves recorded amounts',()=>{
 const original=structuredClone(transactions);render(<WalletHistory transactions={transactions}/>);
 expect(screen.getAllByRole('group').length).toBeGreaterThan(0);
 fireEvent.click(screen.getByRole('button',{name:'Money in'}));expect(screen.queryByText('invoice payment')).toBeNull();expect(screen.getByText('adjustment')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Money out'}));expect(screen.getByText('invoice payment')).toBeTruthy();expect(screen.queryByText('adjustment')).toBeNull();expect(transactions).toEqual(original);
});
it('keeps transaction detail available through a native disclosure',()=>{
 const view=render(<WalletHistory transactions={transactions}/>);
 const disclosures=view.container.querySelectorAll('details');expect(disclosures).toHaveLength(2);
 expect(disclosures[0]!.textContent).toContain('Synthetic invoice');expect(disclosures[0]!.textContent).toContain('$100.00');
});
