import { Fragment } from "react";

/**
 * An email address that, when it cannot fit on one line, wraps after its "@"
 * or before a dot, never between two letters. The break points are <wbr>, so
 * a copied address has nothing added to it.
 */
export function EmailAddress({ address }: { address: string }) {
  return (
    <>
      {address.split(/([@.])/).map((part, index) => (
        <Fragment key={index}>
          {part === "." && <wbr />}
          {part}
          {part === "@" && <wbr />}
        </Fragment>
      ))}
    </>
  );
}

/** Several addresses as one line, separated by commas. */
export function EmailList({ addresses }: { addresses: string[] }) {
  return (
    <>
      {addresses.map((address, index) => (
        <Fragment key={address}>
          {index > 0 && ", "}
          <EmailAddress address={address} />
        </Fragment>
      ))}
    </>
  );
}
