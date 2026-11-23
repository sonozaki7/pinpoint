// Renders **bold** spans from the real T3 message without changing any words.
export function Rich({text}: {text: string}) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
        part.startsWith("**") && part.endsWith("**") ? <b key={index}>{part.slice(2, -2)}</b> : <span key={index}>{part}</span>,
      )}
    </>
  );
}
