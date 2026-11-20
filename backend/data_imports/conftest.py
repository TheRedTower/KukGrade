import pytest

from data_imports.testing import students_to_link_to


@pytest.fixture
def students_exist(db: None) -> None:
    """Past gradings can be imported: there are students to link them to."""
    students_to_link_to()
