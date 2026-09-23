// "use client";

// import { useEffect, useState } from "react";
// import { useParams, useRouter } from "next/navigation";
// import {
//   getStudentQuiz,
//   startAttempt,
// } from "@/services/quiz.service";

// export default function QuizDetail() {
//   const params = useParams();
//   const router = useRouter();

//   const rawId = params?.id;
//   const id = Array.isArray(rawId) ? rawId[0] : rawId;

//   const [d, setD] = useState<any>(null);
//   const [loading, setLoading] = useState(true);
//   const [error, setError] = useState("");

//   useEffect(() => {
//     if (!id || typeof id !== "string") {
//       setError("Quiz ID is missing.");
//       setLoading(false);
//       return;
//     }

//     getStudentQuiz(id)
//       .then((x) => {
//         if (x.success) {
//           setD(x.data);
//         } else {
//           setError(x.message || "Failed to load quiz.");
//         }
//       })
//       .catch((err) => {
//         console.error("Failed to load quiz:", err);
//         setError("Failed to load quiz.");
//       })
//       .finally(() => {
//         setLoading(false);
//       });
//   }, [id]);

//   if (loading) {
//     return <main className="p-6">Loading…</main>;
//   }

//   if (error) {
//     return (
//       <main className="p-6">
//         <p className="text-red-500">{error}</p>
//       </main>
//     );
//   }

//   if (!d) {
//     return <main className="p-6">Quiz not found.</main>;
//   }

//   return (
//     <main className="mx-auto max-w-4xl p-6">
//       <h1 className="text-3xl font-semibold">
//         {d.quiz.title}
//       </h1>

//       <p className="mt-2">
//         {d.quiz.description}
//       </p>

//       <div className="mt-4 rounded-xl border p-4">
//         Questions: {d.questions.length} · Passing:{" "}
//         {d.quiz.passing_score}% · Attempts remaining:{" "}
//         {d.quiz.attempts_remaining ?? "∞"}
//       </div>

//       <div className="mt-6 space-y-3">
//         {d.questions.map((q: any, i: number) => (
//           <div
//             key={q.id}
//             className="rounded-xl border p-4"
//           >
//             <b>
//               {i + 1}. {q.question_text}
//             </b>

//             <div className="mt-2 text-sm text-muted-foreground">
//               {q.options.length} options · {q.points} point(s)
//             </div>
//           </div>
//         ))}
//       </div>

//       <button
//         className="mt-6 rounded-xl bg-primary px-5 py-3 text-primary-foreground"
//         onClick={async () => {
//           if (!id) {
//             console.error("Quiz ID is missing");
//             return;
//           }

//           const x = await startAttempt(id);

//           if (x.success) {
//             router.push(
//               `/student/quizzes/${id}/attempt/${x.data.id}`
//             );
//           }
//         }}
//       >
//         Start Quiz
//       </button>
//     </main>
//   );
// }

"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getStudentQuiz,
  startAttempt,
} from "@/services/quiz.service";

export default function QuizDetail() {
  const params = useParams();
  const router = useRouter();

  const rawId = params?.quizId;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id || typeof id !== "string") {
      setError("Quiz ID is missing.");
      setLoading(false);
      return;
    }

    getStudentQuiz(id)
      .then((x) => {
        if (x.success) {
          setD(x.data);
        } else {
          setError(x.message || "Failed to load quiz.");
        }
      })
      .catch((err) => {
        console.error("Failed to load quiz:", err);
        setError("Failed to load quiz.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return <main className="p-6">Loading…</main>;
  }

  if (error) {
    return (
      <main className="p-6">
        <p className="text-red-500">{error}</p>
      </main>
    );
  }

  if (!d) {
    return <main className="p-6">Quiz not found.</main>;
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-3xl font-semibold">
        {d.quiz.title}
      </h1>

      <p className="mt-2">
        {d.quiz.description}
      </p>

      <div className="mt-4 rounded-xl border p-4">
        Questions: {d.questions.length} · Passing:{" "}
        {d.quiz.passing_score}% · Attempts remaining:{" "}
        {d.quiz.attempts_remaining ?? "∞"}
      </div>

      <div className="mt-6 space-y-3">
        {d.questions.map((q: any, i: number) => (
          <div
            key={q.id}
            className="rounded-xl border p-4"
          >
            <b>
              {i + 1}. {q.question_text}
            </b>

            <div className="mt-2 text-sm text-muted-foreground">
              {q.options.length} options · {q.points} point(s)
            </div>
          </div>
        ))}
      </div>

      <button
        className="mt-6 rounded-xl bg-primary px-5 py-3 text-primary-foreground"
        onClick={async () => {
          if (!id) {
            console.error("Quiz ID is missing");
            return;
          }

          const x = await startAttempt(id);

          if (x.success) {
            router.push(
              `/student/quizzes/${id}/attempt/${x.data.id}`
            );
          }
        }}
      >
        Start Quiz
      </button>
    </main>
  );
}