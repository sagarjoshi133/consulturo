"""Public endpoints tests (no auth required)."""
import pytest
import requests
from conftest import BASE_URL

class TestDoctorInfo:
    """Doctor info endpoint tests."""

    def test_get_doctor_info(self, api_client):
        """GET /api/doctor returns full doctor info with qualifications/clinics/socials."""
        response = api_client.get(f"{BASE_URL}/api/doctor")
        assert response.status_code == 200
        
        data = response.json()
        # Verify required fields
        assert data.get("name") == "Dr. Sagar Joshi"
        assert "title" in data
        assert "qualifications" in data and len(data["qualifications"]) >= 3
        assert "clinics" in data and len(data["clinics"]) >= 2
        assert "socials" in data
        assert "services" in data
        assert "contact" in data
        
        # Verify no MongoDB _id
        assert "_id" not in data
        print("✓ Doctor info endpoint passed")


class TestDiseases:
    """Disease library endpoint tests."""

    def test_list_diseases(self, api_client):
        """GET /api/diseases lists 9 diseases."""
        response = api_client.get(f"{BASE_URL}/api/diseases")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 9, f"Expected >= 9 diseases, got {len(data)}"
        
        # Verify structure
        for disease in data:
            assert "id" in disease
            assert "name" in disease
            assert "icon" in disease
            assert "tagline" in disease
            assert "_id" not in disease
        print("✓ List diseases passed")

    def test_get_disease_detail(self, api_client):
        """GET /api/diseases/{id} returns detail with symptoms/causes/treatments."""
        disease_id = "kidney-stones"
        response = api_client.get(f"{BASE_URL}/api/diseases/{disease_id}")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("id") == disease_id
        assert "name" in data
        assert "symptoms" in data and isinstance(data["symptoms"], list)
        assert "causes" in data and isinstance(data["causes"], list)
        assert "treatments" in data and isinstance(data["treatments"], list)
        assert "overview" in data
        assert "when_to_see" in data
        assert "_id" not in data
        print(f"✓ Disease detail for {disease_id} passed")

    def test_get_disease_not_found(self, api_client):
        """GET /api/diseases/invalid should return 404."""
        response = api_client.get(f"{BASE_URL}/api/diseases/invalid-disease-id")
        assert response.status_code == 404
        print("✓ Disease 404 handling passed")


class TestBlog:
    """Blog endpoint tests."""

    def test_list_blog_posts(self, api_client):
        """GET /api/blog returns 4 posts."""
        response = api_client.get(f"{BASE_URL}/api/blog")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 4, f"Expected >= 4 blog posts, got {len(data)}"
        
        for post in data:
            assert "id" in post
            assert "title" in post
            assert "category" in post
            assert "_id" not in post
        print("✓ List blog posts passed")

    def test_get_blog_post_detail(self, api_client):
        """GET /api/blog/{id} returns post details.

        Uses the first available post rather than a hardcoded id so the
        test keeps passing as content evolves."""
        list_resp = api_client.get(f"{BASE_URL}/api/blog")
        assert list_resp.status_code == 200
        posts = list_resp.json()
        assert len(posts) >= 1, "No blog posts seeded"
        post_id = posts[0]["id"]
        response = api_client.get(f"{BASE_URL}/api/blog/{post_id}")
        assert response.status_code == 200

        data = response.json()
        assert data.get("id") == post_id
        assert "title" in data
        assert ("content" in data) or ("content_html" in data), (
            "Blog post detail must include body text in either the "
            "'content' (plain) or 'content_html' (HTML) field."
        )
        assert "_id" not in data
        print(f"✓ Blog post detail for {post_id} passed")


class TestVideos:
    """Video endpoint tests."""

    def test_list_videos(self, api_client):
        """GET /api/videos returns 4+ items (seed or youtube RSS)."""
        response = api_client.get(f"{BASE_URL}/api/videos")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 4, f"Expected at least 4 videos, got {len(data)}"
        
        for video in data:
            assert "id" in video
            assert "title" in video
            assert "youtube_id" in video or "thumbnail" in video
            assert "_id" not in video
        print("✓ List videos passed")


class TestEducation:
    """Patient education endpoint tests."""

    def test_list_education_guides(self, api_client):
        """GET /api/education returns 5 guides."""
        response = api_client.get(f"{BASE_URL}/api/education")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 5, f"Expected >= 5 education guides, got {len(data)}"
        
        for guide in data:
            assert "id" in guide
            assert "title" in guide
            assert "summary" in guide
            assert "_id" not in guide
        print("✓ List education guides passed")

    def test_get_education_detail(self, api_client):
        """GET /api/education/{id} returns steps."""
        guide_id = "kegel-exercises"
        response = api_client.get(f"{BASE_URL}/api/education/{guide_id}")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("id") == guide_id
        assert "title" in data
        assert "steps" in data and isinstance(data["steps"], list)
        assert len(data["steps"]) > 0
        assert "_id" not in data
        print(f"✓ Education detail for {guide_id} passed")


class TestCalculators:
    """Calculator list endpoint test."""

    def test_list_calculators(self, api_client):
        """GET /api/calculators returns calculator list."""
        response = api_client.get(f"{BASE_URL}/api/calculators")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 4, f"Expected at least 4 calculators, got {len(data)}"
        
        calc_ids = [c["id"] for c in data]
        assert "ipss" in calc_ids
        assert "psa-density" in calc_ids
        assert "egfr" in calc_ids
        assert "bmi" in calc_ids
        print("✓ List calculators passed")
