"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredUser } from "@/lib/auth";
import { analyticsApi } from "@/services/analytics.service";

type Student = {
    id: string;
    full_name: string;
    email: string;
    student_profile_id: string;
    academy: string | null;
    batch: string | null;
    course: string | null;
};

type Subject = {
    id: string;
    name: string;
    code: string;
    description?: string | null;
    language?: string;
    is_active?: boolean;
};

export default function Page() {
    const router = useRouter();

    const [d, setD] = useState<any>();
    const [q, setQ] = useState("");

    const [students, setStudents] = useState<Student[]>([]);
    const [subjects, setSubjects] = useState<Subject[]>([]);

    const [selectedStudent, setSelectedStudent] = useState("");
    const [selectedSubject, setSelectedSubject] = useState("");

    const [selectedInstructor, setSelectedInstructor] = useState("");
    const [loadingAssignment, setLoadingAssignment] = useState(false);

    const [assignmentMessage, setAssignmentMessage] = useState("");
    const [assignmentError, setAssignmentError] = useState("");

    const [academy, setAcademy] = useState("");
    const [batch, setBatch] = useState("");
    const [course, setCourse] = useState("");

    const [loadingEnrollment, setLoadingEnrollment] = useState(false);
    const [enrollmentMessage, setEnrollmentMessage] = useState("");
    const [enrollmentError, setEnrollmentError] = useState("");

    useEffect(() => {
        const u = getStoredUser();

        if (!u || u.role !== "ADMIN") {
            router.replace("/login");
            return;
        }

        Promise.all([
            analyticsApi.adminUsers("page=1&page_size=100"),
            analyticsApi.adminStudents(),
            analyticsApi.adminSubjects(),
        ]).then(([usersData, studentsData, subjectsData]) => {
            setD(usersData);

            if (studentsData?.success === false) {
                setEnrollmentError(
                    studentsData.message || "Failed to load students"
                );
            } else {
                setStudents(
                    studentsData?.data?.items ??
                    studentsData?.items ??
                    studentsData ??
                    []
                );
            }

            if (subjectsData?.success === false) {
                setEnrollmentError(
                    subjectsData.message || "Failed to load subjects"
                );
            } else {
                setSubjects(
                    subjectsData?.data?.items ??
                    subjectsData?.items ??
                    subjectsData ??
                    []
                );
            }
        });
    }, [router]);

    const items = (d?.items || []).filter(
        (x: any) =>
            !q ||
            x.name?.toLowerCase().includes(q.toLowerCase()) ||
            x.email?.toLowerCase().includes(q.toLowerCase())
    );

    const instructors = (d?.items || []).filter(
        (x: any) =>
            x.role === "INSTRUCTOR" &&
            x.status === "ACTIVE"
    );

    async function enrollStudent() {
        setEnrollmentMessage("");
        setEnrollmentError("");

        if (!selectedStudent) {
            setEnrollmentError("Please select a student.");
            return;
        }

        if (!selectedSubject) {
            setEnrollmentError("Please select a subject.");
            return;
        }

        setLoadingEnrollment(true);

        try {
            const response = await analyticsApi.adminEnrollStudent(
                selectedStudent,
                {
                    subject_id: selectedSubject,
                    academy: academy.trim() || null,
                    batch: batch.trim() || null,
                    course: course.trim() || null,
                }
            );

            if (response?.success === false) {
                setEnrollmentError(
                    response.message || "Failed to enroll student."
                );
                return;
            }

            setEnrollmentMessage(
                `Student enrolled successfully in ${subjects.find((s) => s.id === selectedSubject)?.name ||
                "the subject"
                }.`
            );

            setSelectedStudent("");
            setSelectedSubject("");
            setAcademy("");
            setBatch("");
            setCourse("");
        } catch (error: any) {
            setEnrollmentError(
                error?.message || "Failed to enroll student."
            );
        } finally {
            setLoadingEnrollment(false);
        }
    }

    async function assignInstructorSubject() {
        setAssignmentMessage("");
        setAssignmentError("");

        if (!selectedInstructor) {
            setAssignmentError("Please select an instructor.");
            return;
        }

        if (!selectedSubject) {
            setAssignmentError("Please select a subject.");
            return;
        }

        setLoadingAssignment(true);

        try {
            const response =
                await analyticsApi.adminAssignInstructorSubject(
                    selectedInstructor,
                    {
                        subject_id: selectedSubject,
                        active: true,
                    }
                );

            if (response?.success === false) {
                setAssignmentError(
                    response.message || "Failed to assign subject."
                );
                return;
            }

            const subjectName =
                subjects.find((s) => s.id === selectedSubject)?.name ||
                "the subject";

            const instructorName =
                instructors.find(
                    (i: any) => i.id === selectedInstructor
                )?.name || "Instructor";

            setAssignmentMessage(
                `${subjectName} assigned successfully to ${instructorName}.`
            );

            setSelectedInstructor("");
            setSelectedSubject("");
        } catch (error: any) {
            setAssignmentError(
                error?.message || "Failed to assign subject."
            );
        } finally {
            setLoadingAssignment(false);
        }
    }

    return (
        <main className="mx-auto max-w-7xl px-4 py-8">
            <h1 className="text-3xl font-semibold">Users overview</h1>

            <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search users"
                className="mt-5 rounded-xl border px-4 py-2"
            />

            {/* Enrollment Management */}
            <section className="mt-8 rounded-2xl border bg-card p-6">
                <div className="mb-5">
                    <h2 className="text-xl font-semibold">
                        Enrollment Management
                    </h2>

                    <p className="mt-1 text-sm text-muted-foreground">
                        Assign a subject to a student without manually editing the
                        database.
                    </p>
                </div>

                {enrollmentError && (
                    <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {enrollmentError}
                    </div>
                )}

                {enrollmentMessage && (
                    <div className="mb-4 rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700">
                        {enrollmentMessage}
                    </div>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                    {/* Student */}
                    <div>
                        <label className="mb-1 block text-sm font-medium">
                            Student
                        </label>

                        <select
                            value={selectedStudent}
                            onChange={(e) => {
                                const studentId = e.target.value;
                                setSelectedStudent(studentId);

                                const student = students.find(
                                    (s) => s.id === studentId
                                );

                                if (student) {
                                    setAcademy(student.academy || "");
                                    setBatch(student.batch || "");
                                    setCourse(student.course || "");
                                }
                            }}
                            className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm"
                        >
                            <option value="">Select student</option>

                            {students.map((student) => (
                                <option key={student.id} value={student.id}>
                                    {student.full_name} — {student.email}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Subject */}
                    <div>
                        <label className="mb-1 block text-sm font-medium">
                            Subject
                        </label>

                        <select
                            value={selectedSubject}
                            onChange={(e) =>
                                setSelectedSubject(e.target.value)
                            }
                            className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm"
                        >
                            <option value="">Select subject</option>

                            {subjects
                                .filter(
                                    (subject) =>
                                        subject.is_active !== false
                                )
                                .map((subject) => (
                                    <option key={subject.id} value={subject.id}>
                                        {subject.name} ({subject.code})
                                    </option>
                                ))}
                        </select>
                    </div>

                    {/* Academy */}
                    <div>
                        <label className="mb-1 block text-sm font-medium">
                            Academy
                        </label>

                        <input
                            value={academy}
                            onChange={(e) => setAcademy(e.target.value)}
                            placeholder="Academy"
                            className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm"
                        />
                    </div>

                    {/* Batch */}
                    <div>
                        <label className="mb-1 block text-sm font-medium">
                            Batch
                        </label>

                        <input
                            value={batch}
                            onChange={(e) => setBatch(e.target.value)}
                            placeholder="Batch"
                            className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm"
                        />
                    </div>

                    {/* Course */}
                    <div>
                        <label className="mb-1 block text-sm font-medium">
                            Course
                        </label>

                        <input
                            value={course}
                            onChange={(e) => setCourse(e.target.value)}
                            placeholder="Course"
                            className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm"
                        />
                    </div>
                </div>

                <button
                    onClick={enrollStudent}
                    disabled={
                        loadingEnrollment ||
                        !selectedStudent ||
                        !selectedSubject
                    }
                    className="mt-5 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {loadingEnrollment
                        ? "Enrolling..."
                        : "Enroll Student"}
                </button>
            </section>

            {/* Instructor Subject Management */}
            <section className="mt-8 rounded-2xl border bg-card p-6">
                <div className="mb-5">
                    <h2 className="text-xl font-semibold">
                        Instructor Subject Management
                    </h2>

                    <p className="mt-1 text-sm text-muted-foreground">
                        Assign a subject to an instructor without manually entering
                        InstructorProfile IDs.
                    </p>
                </div>

                {assignmentError && (
                    <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {assignmentError}
                    </div>
                )}

                {assignmentMessage && (
                    <div className="mb-4 rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700">
                        {assignmentMessage}
                    </div>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                    {/* Instructor */}
                    <div>
                        <label className="mb-1 block text-sm font-medium">
                            Instructor
                        </label>

                        <select
                            value={selectedInstructor}
                            onChange={(e) =>
                                setSelectedInstructor(e.target.value)
                            }
                            className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm"
                        >
                            <option value="">Select instructor</option>

                            {instructors.map((instructor: any) => (
                                <option
                                    key={instructor.id}
                                    value={instructor.id}
                                >
                                    {instructor.name} — {instructor.email}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Subject */}
                    <div>
                        <label className="mb-1 block text-sm font-medium">
                            Subject
                        </label>

                        <select
                            value={selectedSubject}
                            onChange={(e) =>
                                setSelectedSubject(e.target.value)
                            }
                            className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm"
                        >
                            <option value="">Select subject</option>

                            {subjects
                                .filter(
                                    (subject) =>
                                        subject.is_active !== false
                                )
                                .map((subject) => (
                                    <option
                                        key={subject.id}
                                        value={subject.id}
                                    >
                                        {subject.name} ({subject.code})
                                    </option>
                                ))}
                        </select>
                    </div>
                </div>

                <button
                    onClick={assignInstructorSubject}
                    disabled={
                        loadingAssignment ||
                        !selectedInstructor ||
                        !selectedSubject
                    }
                    className="mt-5 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {loadingAssignment
                        ? "Assigning..."
                        : "Assign Subject"}
                </button>
            </section>

            {/* Existing Users Overview */}
            <div className="mt-8 overflow-x-auto rounded-2xl border bg-card">
                <table className="w-full text-left text-sm">
                    <thead>
                        <tr className="border-b text-muted-foreground">
                            <th className="p-4">Name</th>
                            <th>Role</th>
                            <th>Status</th>
                            <th>Last login</th>
                            <th>Enrollments</th>
                        </tr>
                    </thead>

                    <tbody>
                        {items.map((x: any) => (
                            <tr
                                key={x.id}
                                className="border-b last:border-0"
                            >
                                <td className="p-4">
                                    <b>{x.name}</b>

                                    <span className="block text-xs text-muted-foreground">
                                        {x.email}
                                    </span>
                                </td>

                                <td>{x.role}</td>

                                <td>{x.status}</td>

                                <td>
                                    {x.last_login_at
                                        ? new Date(
                                            x.last_login_at
                                        ).toLocaleString()
                                        : "Never"}
                                </td>

                                <td>{x.enrollment_count}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </main>
    );
}