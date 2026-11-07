import { startTransition, StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';

// Router updates apply at once rather than as transitions: what a view shows, such as the
// previewed photo, follows every key press, however fast they repeat. Views that should hold
// what they show until the next is ready, as the viewer does while a photo decodes, defer it
// themselves, as gallery views do while their folder loads. React Router
// recommends this for apps that read external stores, as the gallery's scan is.
startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter useTransitions={false} />
    </StrictMode>,
  );
});
