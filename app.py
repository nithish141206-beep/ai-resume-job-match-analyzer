from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.utils import secure_filename

import os
import re
import math

import fitz  # PyMuPDF
from docx import Document

from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity


# ============================================================
# APP CONFIGURATION
# ============================================================

app = Flask(__name__)
CORS(app)

app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # 10 MB

ALLOWED_EXTENSIONS = {"pdf", "docx", "txt"}

# Model is loaded only when analysis is requested
model = None


# ============================================================
# SKILL DATABASE
# ============================================================

SKILLS = [
    # Programming
    "Python",
    "Java",
    "C",
    "C++",
    "C#",
    "JavaScript",
    "TypeScript",
    "PHP",
    "Ruby",
    "Go",
    "Rust",
    "Kotlin",
    "Swift",

    # Web
    "HTML",
    "CSS",
    "React",
    "Angular",
    "Vue",
    "Node.js",
    "Express.js",
    "Next.js",

    # Backend
    "Flask",
    "FastAPI",
    "Django",
    "Spring Boot",
    "REST API",
    "API Development",

    # Database
    "SQL",
    "MySQL",
    "PostgreSQL",
    "MongoDB",
    "Oracle",
    "SQLite",
    "Redis",

    # Cloud / DevOps
    "AWS",
    "Azure",
    "Google Cloud",
    "GCP",
    "Docker",
    "Kubernetes",
    "Jenkins",
    "CI/CD",
    "Linux",

    # AI / ML
    "Machine Learning",
    "Deep Learning",
    "Artificial Intelligence",
    "Natural Language Processing",
    "NLP",
    "Computer Vision",
    "TensorFlow",
    "PyTorch",
    "Scikit-learn",
    "Pandas",
    "NumPy",
    "OpenCV",

    # Data
    "Data Analysis",
    "Data Science",
    "Data Visualization",
    "Power BI",
    "Tableau",
    "Excel",

    # Tools
    "Git",
    "GitHub",
    "GitLab",
    "Jira",
    "Postman",

    # Engineering / General
    "Problem Solving",
    "Communication",
    "Teamwork",
    "Leadership",
    "Time Management",
    "Critical Thinking",
    "Project Management",

    # Other technical
    "Cybersecurity",
    "Networking",
    "TCP/IP",
    "IoT",
    "Arduino",
    "ESP32",
    "Embedded Systems",
    "MATLAB",
    "SolidWorks",
]


# Aliases → standard skill name
SKILL_ALIASES = {
    "js": "JavaScript",
    "javascript": "JavaScript",

    "ts": "TypeScript",
    "typescript": "TypeScript",

    "node": "Node.js",
    "nodejs": "Node.js",
    "node.js": "Node.js",

    "reactjs": "React",
    "react.js": "React",

    "express": "Express.js",
    "expressjs": "Express.js",

    "ml": "Machine Learning",
    "machine learning": "Machine Learning",

    "ai": "Artificial Intelligence",
    "artificial intelligence": "Artificial Intelligence",

    "nlp": "Natural Language Processing",
    "natural language processing": "Natural Language Processing",

    "dl": "Deep Learning",
    "deep learning": "Deep Learning",

    "sklearn": "Scikit-learn",
    "scikit learn": "Scikit-learn",

    "postgres": "PostgreSQL",

    "mongodb": "MongoDB",
    "mongo": "MongoDB",

    "aws": "AWS",
    "amazon web services": "AWS",

    "gcp": "Google Cloud",
    "google cloud platform": "Google Cloud",

    "powerbi": "Power BI",
    "power bi": "Power BI",

    "cicd": "CI/CD",
    "ci/cd": "CI/CD",

    "rest": "REST API",
    "restful api": "REST API",
}


# ============================================================
# UTILITY FUNCTIONS
# ============================================================

def allowed_file(filename):
    if not filename:
        return False

    extension = filename.rsplit(".", 1)[-1].lower()

    return extension in ALLOWED_EXTENSIONS


def normalize_text(text):
    """
    Clean extracted text while preserving useful words.
    """
    if not text:
        return ""

    text = text.replace("\x00", " ")
    text = re.sub(r"\s+", " ", text)

    return text.strip()


# ============================================================
# DOCUMENT EXTRACTION
# ============================================================

def extract_pdf(file_storage):
    """
    Extract text from PDF.
    """

    file_bytes = file_storage.read()

    document = fitz.open(
        stream=file_bytes,
        filetype="pdf"
    )

    pages = []

    for page in document:
        pages.append(page.get_text())

    document.close()

    return normalize_text("\n".join(pages))


def extract_docx(file_storage):
    """
    Extract text from DOCX.
    """

    document = Document(file_storage)

    parts = []

    # Paragraphs
    for paragraph in document.paragraphs:
        if paragraph.text.strip():
            parts.append(paragraph.text)

    # Tables
    for table in document.tables:
        for row in table.rows:
            row_text = []

            for cell in row.cells:
                if cell.text.strip():
                    row_text.append(cell.text)

            if row_text:
                parts.append(" ".join(row_text))

    return normalize_text("\n".join(parts))


def extract_txt(file_storage):
    """
    Extract text from TXT.
    """

    raw = file_storage.read()

    try:
        return normalize_text(raw.decode("utf-8"))
    except UnicodeDecodeError:
        return normalize_text(raw.decode("latin-1", errors="ignore"))


def extract_file_text(file_storage):
    """
    Detect file type and extract text.
    """

    filename = secure_filename(file_storage.filename)

    if not filename:
        raise ValueError("Invalid file name.")

    extension = filename.rsplit(".", 1)[-1].lower()

    if extension == "pdf":
        return extract_pdf(file_storage)

    if extension == "docx":
        return extract_docx(file_storage)

    if extension == "txt":
        return extract_txt(file_storage)

    if extension == "doc":
        raise ValueError(
            "Legacy .doc files are not supported directly. "
            "Please save the document as .docx or PDF."
        )

    raise ValueError(
        f"Unsupported file type: .{extension}"
    )


# ============================================================
# SKILL EXTRACTION
# ============================================================

def skill_present(skill, text):
    """
    Check whether a skill occurs in text.

    Handles multi-word skills and special characters.
    """

    text_lower = text.lower()

    # Direct phrase matching for special cases
    if skill.lower() in text_lower:
        return True

    # Word based matching
    words = re.findall(r"[a-zA-Z0-9+#.]+", skill.lower())

    if not words:
        return False

    pattern = r"\b" + r"\s+".join(
        re.escape(word) for word in words
    ) + r"\b"

    return bool(re.search(pattern, text_lower))


def extract_skills(text):
    """
    Extract known technical and professional skills.
    """

    found = []

    for skill in SKILLS:

        if skill_present(skill, text):
            found.append(skill)

    # Alias matching
    text_lower = text.lower()

    for alias, standard_skill in SKILL_ALIASES.items():

        if alias in text_lower and standard_skill not in found:
            found.append(standard_skill)

    # Remove duplicates while preserving order
    unique = []

    for skill in found:
        if skill not in unique:
            unique.append(skill)

    return sorted(unique)


# ============================================================
# AI MODEL
# ============================================================

def get_model():
    """
    Load Sentence Transformer only once.
    """

    global model

    if model is None:
        print("\nLoading AI semantic model...")
        print("First run may take some time because the model is downloaded.\n")

        model = SentenceTransformer(
            "all-MiniLM-L6-v2"
        )

        print("AI model loaded successfully.\n")

    return model


# ============================================================
# SEMANTIC SIMILARITY
# ============================================================

def calculate_semantic_similarity(resume_text, job_text):
    """
    Calculate semantic similarity between resume and job description.
    """

    ai_model = get_model()

    embeddings = ai_model.encode(
        [resume_text, job_text],
        normalize_embeddings=True
    )

    similarity = cosine_similarity(
        [embeddings[0]],
        [embeddings[1]]
    )[0][0]

    # Keep result inside 0-1
    similarity = max(0.0, min(1.0, float(similarity)))

    return similarity


# ============================================================
# PER-SKILL SIMILARITY
# ============================================================

def calculate_skill_similarity(
    resume_text,
    job_skills
):
    """
    Calculate how strongly each job skill is represented
    semantically in the resume.
    """

    if not job_skills:
        return {}

    ai_model = get_model()

    resume_embedding = ai_model.encode(
        [resume_text],
        normalize_embeddings=True
    )

    skill_embeddings = ai_model.encode(
        job_skills,
        normalize_embeddings=True
    )

    similarities = cosine_similarity(
        resume_embedding,
        skill_embeddings
    )[0]

    result = {}

    for skill, score in zip(
        job_skills,
        similarities
    ):
        score = float(score)

        # Convert to percentage
        percentage = max(
            0,
            min(
                100,
                round(score * 100, 1)
            )
        )

        result[skill] = percentage

    return result


# ============================================================
# MATCH SCORE
# ============================================================

def calculate_match_score(
    semantic_similarity,
    resume_skills,
    job_skills
):
    """
    Final score combines:

    60% semantic similarity
    40% skill overlap
    """

    if job_skills:

        matching_skills = [
            skill
            for skill in job_skills
            if skill in resume_skills
        ]

        skill_overlap = (
            len(matching_skills) /
            len(job_skills)
        )

    else:
        skill_overlap = 0.0

    semantic_score = semantic_similarity * 100
    skill_score = skill_overlap * 100

    if job_skills:
        final_score = (
            semantic_score * 0.60
            + skill_score * 0.40
        )
    else:
        final_score = semantic_score

    return round(
        max(0, min(100, final_score))
    )


# ============================================================
# FIT LEVEL
# ============================================================

def get_fit_level(score):

    if score >= 80:
        return "Excellent Fit"

    if score >= 65:
        return "Strong Fit"

    if score >= 50:
        return "Moderate Fit"

    return "Needs Improvement"


# ============================================================
# JOB ROLE DETECTION
# ============================================================

def detect_job_role(job_text):
    """
    Try to identify the job role from the job description.
    """

    common_roles = [
        "Software Engineer",
        "Software Developer",
        "Python Developer",
        "Java Developer",
        "Full Stack Developer",
        "Frontend Developer",
        "Backend Developer",
        "Web Developer",
        "Data Scientist",
        "Data Analyst",
        "Machine Learning Engineer",
        "AI Engineer",
        "DevOps Engineer",
        "Cloud Engineer",
        "Cybersecurity Analyst",
        "Embedded Engineer",
        "Embedded Systems Engineer",
        "IoT Engineer",
        "Network Engineer",
        "Electrical Engineer",
        "Electronics Engineer",
    ]

    text_lower = job_text.lower()

    for role in common_roles:

        if role.lower() in text_lower:
            return role

    # Try to detect first meaningful line
    lines = [
        line.strip()
        for line in job_text.splitlines()
        if line.strip()
    ]

    if lines:
        first_line = lines[0]

        if len(first_line) <= 100:
            return first_line

    return "Job Position"


# ============================================================
# RECOMMENDATIONS
# ============================================================

def generate_recommendations(
    missing_skills,
    matching_skills,
    score
):
    recommendations = []

    if missing_skills:

        for skill in missing_skills[:5]:

            recommendations.append(
                f"Consider improving your {skill} skills "
                f"through a practical project or certification."
            )

    if not missing_skills:

        recommendations.append(
            "Your detected skills cover the main skills "
            "identified in the job description."
        )

    if score < 50:

        recommendations.append(
            "Improve the alignment between your resume "
            "and the job requirements by highlighting "
            "relevant projects and technical experience."
        )

    elif score < 70:

        recommendations.append(
            "Add more evidence of your relevant technical "
            "skills through projects, internships, or experience."
        )

    else:

        recommendations.append(
            "Your resume shows strong alignment with this "
            "job. Keep your project and experience descriptions "
            "specific and measurable."
        )

    if matching_skills:

        recommendations.append(
            "Make sure your strongest matching skills are "
            "clearly visible in the Skills and Projects sections."
        )

    return recommendations


# ============================================================
# HEALTH CHECK
# ============================================================

@app.route("/api/health", methods=["GET"])
def health():

    return jsonify({
        "status": "ok",
        "service": "AI Resume & Job Match Analyzer",
        "ai_model_loaded": model is not None
    })


# ============================================================
# MAIN ANALYSIS API
# ============================================================

@app.route("/api/analyze", methods=["POST"])
def analyze():

    try:

        # ----------------------------------------------------
        # Check resume
        # ----------------------------------------------------

        if "resume" not in request.files:

            return jsonify({
                "error": "Resume file is required."
            }), 400

        resume_file = request.files["resume"]

        if not resume_file.filename:

            return jsonify({
                "error": "Please select a resume file."
            }), 400

        if not allowed_file(
            resume_file.filename
        ):

            return jsonify({
                "error":
                "Resume must be PDF, DOCX, or TXT."
            }), 400

        # ----------------------------------------------------
        # Extract resume
        # ----------------------------------------------------

        resume_text = extract_file_text(
            resume_file
        )

        if not resume_text.strip():

            return jsonify({
                "error":
                "Could not extract text from the resume."
            }), 400

        # ----------------------------------------------------
        # Get job description
        # ----------------------------------------------------

        job_text = ""

        # Uploaded job file
        if "job_file" in request.files:

            job_file = request.files["job_file"]

            if job_file.filename:

                if not allowed_file(
                    job_file.filename
                ):

                    return jsonify({
                        "error":
                        "Job file must be PDF, DOCX, or TXT."
                    }), 400

                job_text = extract_file_text(
                    job_file
                )

        # Text area job description
        if not job_text.strip():

            job_text = request.form.get(
                "job_text",
                ""
            )

        job_text = normalize_text(job_text)

        if not job_text:

            return jsonify({
                "error":
                "Please provide a job description."
            }), 400

        # ----------------------------------------------------
        # Extract skills
        # ----------------------------------------------------

        resume_skills = extract_skills(
            resume_text
        )

        job_skills = extract_skills(
            job_text
        )

        matching_skills = [
            skill
            for skill in job_skills
            if skill in resume_skills
        ]

        missing_skills = [
            skill
            for skill in job_skills
            if skill not in resume_skills
        ]

        # ----------------------------------------------------
        # Semantic AI similarity
        # ----------------------------------------------------

        semantic_similarity = (
            calculate_semantic_similarity(
                resume_text,
                job_text
            )
        )

        # ----------------------------------------------------
        # Final score
        # ----------------------------------------------------

        match_score = calculate_match_score(
            semantic_similarity,
            resume_skills,
            job_skills
        )

        fit_level = get_fit_level(
            match_score
        )

        # ----------------------------------------------------
        # Per skill semantic similarity
        # ----------------------------------------------------

        per_skill_similarity = (
            calculate_skill_similarity(
                resume_text,
                job_skills
            )
        )

        # ----------------------------------------------------
        # Recommendations
        # ----------------------------------------------------

        recommendations = (
            generate_recommendations(
                missing_skills,
                matching_skills,
                match_score
            )
        )

        # ----------------------------------------------------
        # Job role
        # ----------------------------------------------------

        job_role = detect_job_role(
            job_text
        )

        # ----------------------------------------------------
        # Final API response
        # ----------------------------------------------------

        response = {

            "success": True,

            "resume_label":
                secure_filename(
                    resume_file.filename
                ),

            "job_role":
                job_role,

            "match_score":
                match_score,

            "fit_level":
                fit_level,

            "semantic_similarity":
                round(
                    semantic_similarity * 100,
                    1
                ),

            "resume_skills":
                resume_skills,

            "job_skills":
                job_skills,

            "matching_skills":
                matching_skills,

            "missing_skills":
                missing_skills,

            "resume_skill_count":
                len(resume_skills),

            "matching_skill_count":
                len(matching_skills),

            "missing_skill_count":
                len(missing_skills),

            "per_skill_similarity":
                per_skill_similarity,

            "recommendations":
                recommendations
        }

        return jsonify(response)

    except ValueError as error:

        return jsonify({
            "error": str(error)
        }), 400

    except Exception as error:

        print("\nBackend error:")
        print(error)

        return jsonify({
            "error":
            "Analysis failed. Please check the backend terminal for details."
        }), 500


# ============================================================
# ERROR HANDLERS
# ============================================================

@app.errorhandler(413)
def file_too_large(error):

    return jsonify({
        "error":
        "File is too large. Maximum size is 10 MB."
    }), 413


@app.errorhandler(404)
def not_found(error):

    return jsonify({
        "error":
        "API endpoint not found."
    }), 404


# ============================================================
# START SERVER
# ============================================================

if __name__ == "__main__":

    print("\n==============================================")
    print(" AI Resume & Job Match Analyzer")
    print(" Backend Server")
    print("==============================================")
    print("Server: http://127.0.0.1:5000")
    print("Health: http://127.0.0.1:5000/api/health")
    print("Analysis: http://127.0.0.1:5000/api/analyze")
    print("==============================================\n")

    app.run(
        host="0.0.0.0",
        port=5000,
        debug=True
    )